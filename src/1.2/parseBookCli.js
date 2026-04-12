#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ParserLib = require("./parserLib.js");

// =====================================================
// LOG FLAGS
// =====================================================
const FLAGS = {
  // Start options
  StartAfterLine: 0, // 0 = start from beginning

  // Logging options
  LogChapterTitle: true,
  LogSectionTitle: true,
  LogSubSectionTitle: true,
  LogTextInitial: true,
  LogTextFull: false,
  GroupConsecutiveTextIntoParagraphs: false,
  GroupFullChapter: false,

  // Speech options
  LogSayCommands: false,
  SpeakText: true,

  // Audio file generation options
  GenerateChapterAudioFiles: false,
  OutputDir: "./audio",
  KeepPartFiles: false,

  // Speech options
  SayContext: "En1", // "En1", "It1"

  // Pause durations (in milliseconds)
  StandardPause: 600,
  LongPause: 1000
};

const ModePresets = {
  En1: {
    VerySlow:   { voice: "Zoe",      rate: 30 },
    Slow:       { voice: "Zoe",      rate: 115 },
    Calm:       { voice: "Zoe",      rate: 135 },
    Reflective: { voice: "Zoe",      rate: 150 },
    Neutral:    { voice: "Zoe",      rate: 165 },
    Fast:       { voice: "Zoe",      rate: 200 },
    VeryFast:   { voice: "Zoe",      rate: 230 },
    Intense:    { voice: "Zoe",      rate: 260 },
    Gentle:     { voice: "Samantha", rate: 130 }
  },
  It1: {
    VerySlow:   { voice: "Emma",     rate: 30 },
    Slow:       { voice: "Emma",     rate: 115 },
    Calm:       { voice: "Emma",     rate: 135 },
    Reflective: { voice: "Emma",     rate: 150 },
    Neutral:    { voice: "Emma",     rate: 165 },
    Fast:       { voice: "Emma",     rate: 200 },
    VeryFast:   { voice: "Emma",     rate: 230 },
    Intense:    { voice: "Emma",     rate: 260 },
    Gentle:     { voice: "Emma",     rate: 130 }
  }
};

// Extend flags with derived parameters
function updateFLAGS(optionName, newValue) {
  let result = false
  // See voices: say -v "?"
  // Voice Parameters (for "say" command on macOS)
  if( optionName === "SayContext" ) {
    newValue = (newValue || FLAGS.SayContext || "").trim();
    switch (newValue) {
      case "En1":
        FLAGS.SayContext = "En1";
        FLAGS.SayVoice = "Zoe";
        FLAGS.SayRate = 160;
        result = true;
        break;
      case "It1":
        FLAGS.SayContext = "It1";
        FLAGS.SayVoice = "Emma";
        FLAGS.SayRate = 160;
        result = true;
        break;
    }
  } else if( optionName === "Mode" ) {
    const mode = ModePresets[FLAGS.SayContext] ? ModePresets[FLAGS.SayContext][newValue] : null;
    if (mode) {
      FLAGS.SayVoice = mode.voice;
      FLAGS.SayRate = mode.rate;
      result = true;
    }
  } else if( optionName === "FinalAudioFormat" ) {
    switch (newValue) {
      case "aiff":
      case "aif":
        FLAGS.FinalAudioFormat = "aiff";
        result = true;
        break;
      case "acx":
      case "mp3":
        FLAGS.FinalAudioFormat = newValue;
        FLAGS.FinalAudioBitrate = "192k";
        FLAGS.FinalAudioSampleRate = 44100;
        FLAGS.FinalAudioChannels = 1;
        result = true;
        break;
      case "wav":
        FLAGS.FinalAudioFormat = "wav";
        result = true;
        break;
    }
  }
  return result;
}
updateFLAGS("SayContext");


function isSpeechSettingParameterName(name) {
  return name === "Mode" ||
         name === "SayVoice" ||
         name === "SayRate" ||
         name === "SayContext";
}

function shouldAccumulateChapterAudio() {
  return FLAGS.GroupFullChapter || FLAGS.GenerateChapterAudioFiles;
}

function sanitizeFileName(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function getFinalAudioExtension() {
  if (FLAGS.FinalAudioFormat === "acx" || FLAGS.FinalAudioFormat === "mp3") {
    return "mp3";
  }
  return "aiff";
}

function buildChapterFilePath(chapterIndex, chapterTitle) {
  const safeTitle = sanitizeFileName(chapterTitle || `chapter-${chapterIndex}`)
    .slice(0, 60);

  const ext = getFinalAudioExtension();
  const fileName = `${String(chapterIndex).padStart(2, "0")}-${safeTitle}.${ext}`;
  return path.join(FLAGS.OutputDir, fileName);
}

function buildChapterPartFilePath(chapterIndex, chapterTitle, partIndex) {
  const safeTitle = sanitizeFileName(chapterTitle || `chapter-${chapterIndex}`)
    .slice(0, 60);

  const partsDir = path.join(FLAGS.OutputDir, "_parts");
  const fileName =
    `${String(chapterIndex).padStart(2, "0")}-${safeTitle}.part${String(partIndex).padStart(3, "0")}.aiff`;

  return path.join(partsDir, fileName);
}

async function mergeAudioFiles(partFiles, outputFile) {
  if (partFiles.length === 0) {
    return;
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  // Shotcut for single file + AIFF (no re-encoding needed, just copy)
  if (partFiles.length === 1 && getFinalAudioExtension() === "aiff") {
    fs.copyFileSync(partFiles[0], outputFile);
    return;
  }

  const listFile = path.join(
    path.dirname(outputFile),
    `${path.basename(outputFile, path.extname(outputFile))}.parts.txt`
  );

  const listContent = partFiles
    .map(file => `file '${path.resolve(file).replace(/'/g, "'\\''")}'`)
    .join("\n");

  fs.writeFileSync(listFile, listContent, "utf8");

  // await new Promise((resolve, reject) => {
  //   const child = spawn("ffmpeg", [
  //     "-y",
  //     "-f", "concat",
  //     "-safe", "0",
  //     "-i", listFile,
  //     "-c", "copy",
  //     outputFile
  //   ]);

  //   child.on("error", reject);
  //   child.on("close", code => {
  //     if (code === 0) {
  //       resolve();
  //     } else {
  //       reject(new Error(`ffmpeg exited with code ${code}`));
  //     }
  //   });
  // });
  const ffmpegArgs = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile
  ];

  if (FLAGS.FinalAudioFormat === "acx" || FLAGS.FinalAudioFormat === "mp3") {
    ffmpegArgs.push(
      "-ar", String(FLAGS.FinalAudioSampleRate || 44100),
      "-ac", String(FLAGS.FinalAudioChannels || 1),
      "-codec:a", "libmp3lame",
      "-b:a", String(FLAGS.FinalAudioBitrate || "192k")
    );
  } else {
    ffmpegArgs.push("-c", "copy");
  }

  ffmpegArgs.push(outputFile);

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  try { fs.unlinkSync(listFile); } catch (_) {}
}

async function flushChapterBuffer(chapterBuffer, chapterTitle, chapterIndex) {
  if (chapterBuffer.length === 0) {
    return;
  }

  const fullText = chapterBuffer.join("\n\n").trim();
  if (!fullText) {
    return;
  }

  try {
    if (FLAGS.GenerateChapterAudioFiles) {
      fs.mkdirSync(FLAGS.OutputDir, { recursive: true });

      const outputFile = buildChapterPartFilePath(chapterIndex, chapterTitle);
      console.log(`[WRITE CHAPTER] ${chapterTitle} -> ${outputFile}`);
      await speakText(fullText, outputFile);
    } else if (FLAGS.SpeakText) {
      console.log(`[SPEAK CHAPTER] ${chapterTitle}`);
      await speakText(fullText);
    }
  } catch (err) {
    console.error(`Speech error for chapter "${chapterTitle}": ${err.message}`);
  }
}

async function consoleLogger(type, message, item) {
  //console.log(message);

  if (FLAGS.SpeakText && (type === "text" || type === "chapter" || type === "section" || type === "subsection")) {
    try {
      await speakText(item.text);
    } catch (err) {
      console.error(`Speech error at line ${item.lineNumber}: ${err.message}`);
    }
  }
}

function convertFlagValue(rawValue, currentValue, optionName = "") {
  if (typeof currentValue === "boolean") {
    const v = String(rawValue).trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }

  if (optionName === "StartAfterLine") {
    const trimmed = String(rawValue).trim();
    const n = Number(trimmed);
    return Number.isNaN(n) ? trimmed : n;
  }

  if (typeof currentValue === "number") {
    const n = Number(rawValue);
    return Number.isNaN(n) ? currentValue : n;
  }

  return String(rawValue).trim();
}

function applyParameterToFlags(item) {
  const isSoftFlag = updateFLAGS(item.name, item.value);

  if( !isSoftFlag ) {
    if (!Object.prototype.hasOwnProperty.call(FLAGS, item.name)) {
      console.log(`[PARAM IGNORED] line ${item.lineNumber}: unknown flag "${item.name}"`);
      return;
    }

    //FLAGS[item.name] = convertFlagValue(item.value, FLAGS[item.name]);
    FLAGS[item.name] = convertFlagValue(item.value, FLAGS[item.name], item.name);
  }

  console.log(
    `[PARAM]      line ${item.lineNumber}: ${item.name} = ${item.value}`
  );
}

function speakText(text, outputFile = null) {
  return new Promise((resolve, reject) => {
    const args = [];

    if (FLAGS.SayVoice) {
      args.push("-v", String(FLAGS.SayVoice));
    }

    if (FLAGS.SayRate) {
      args.push("-r", String(FLAGS.SayRate));
    }

    if (outputFile) {
      args.push("-o", outputFile);
    }

    //console.log(`[SAY] voice=${FLAGS.SayVoice} rate=${FLAGS.SayRate}`);

    args.push(text);

    if( FLAGS.LogSayCommands ) {
      console.log(`[SAY COMMAND] say ${args.map(a => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
    }
    const child = spawn("say", args);

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`say exited with code ${code}`));
      }
    });
  });
}

function checkForStartTargetChange(started, item) {
  if (item.name === "StartAfterLine") {
    const target = FLAGS.StartAfterLine;

    if (typeof target === "number") {
      if (target > item.lineNumber) {
        console.log(`--- Jumping forward to line ${target} ---`);
        started = false;
      }
    } else if (typeof target === "string" && target.trim() !== "") {
      console.log(`--- Jumping forward until text contains "${target}" ---`);
      started = false;
    }
  }
  return started;
}

function hasReachedStartTarget(item) {
  const target = FLAGS.StartAfterLine;

  if (!target || target === 0) {
    return true;
  }

  if (typeof target === "number") {
    return item.lineNumber >= target;
  }

  const numericTarget = Number(target);
  if (!Number.isNaN(numericTarget) && String(target).trim() !== "") {
    return item.lineNumber >= numericTarget;
  }

  const textTarget = String(target).trim().toLowerCase();
  if (!textTarget) {
    return true;
  }

  const haystacks = [
    item.text,
    item.raw,
    item.name,
    item.value
  ]
    .filter(v => typeof v === "string")
    .map(v => v.toLowerCase());

  return haystacks.some(v => v.includes(textTarget));
}

// Local buffer for grouping consecutive text lines 
// into paragraphs (not using parserLip options)
let paragraphBuffer = []; 

async function flushParagraphBuffer() {
  if (paragraphBuffer.length === 0) {
    return;
  }

  const firstLineNumber = paragraphBuffer[0].lineNumber;
  const textBlock = paragraphBuffer
    .map(entry => entry.text)
    .join("\n")
    .trim();
  paragraphBuffer = [];

  if (!textBlock) {
    return;
  }

  const syntheticItem = {
    type: "text",
    text: textBlock,
    lineNumber: firstLineNumber
  };

  if (FLAGS.LogTextFull) {
    console.log(`[TEXT FULL]  line ${syntheticItem.lineNumber}: ${syntheticItem.text}`);
  } else if (FLAGS.LogTextInitial) {
    console.log(`[TEXT]       line ${syntheticItem.lineNumber}: ${ParserLib.previewText(syntheticItem.text)}`);
  }

  if (shouldAccumulateChapterAudio()) {
    pushChapterContent(syntheticItem.text);
  } else {
    await consoleLogger(
      "text",
      FLAGS.LogTextFull
        ? `[TEXT FULL]  line ${syntheticItem.lineNumber}: ${syntheticItem.text}`
        : `[TEXT]       line ${syntheticItem.lineNumber}: ${ParserLib.previewText(syntheticItem.text)}`,
      syntheticItem
    );
  }
}

//--------------------------------------------------------------------
// Merging audio file helper functions
//--------------------------------------------------------------------
// Buffers for chapter and audio file generation
let chapterBuffer = [];
let currentChapterTitle = "";
let chapterIndex = 0;
let chapterChunkBuffer = [];
let chapterPartFiles = [];

function pushChapterContent(text) {
  if (!shouldAccumulateChapterAudio()) {
    return;
  }

  if (FLAGS.GenerateChapterAudioFiles) {
    chapterChunkBuffer.push(text);
  } else {
    chapterBuffer.push(text);
  }
}

async function flushChapterChunkBuffer() {
  if (!FLAGS.GenerateChapterAudioFiles) {
    return;
  }

  if (chapterChunkBuffer.length === 0) {
    return;
  }

  const fullText = chapterChunkBuffer.join("\n\n").trim();
  if (!fullText) {
    chapterChunkBuffer = [];
    return;
  }

  fs.mkdirSync(path.join(FLAGS.OutputDir, "_parts"), { recursive: true });

  const partIndex = chapterPartFiles.length + 1;
  const outputFile = buildChapterPartFilePath(chapterIndex, currentChapterTitle, partIndex);

  console.log(
    `[WRITE PART]   ${currentChapterTitle} -> ${path.basename(outputFile)} ` +
    `[voice=${FLAGS.SayVoice} rate=${FLAGS.SayRate}]`
  );

  await speakText(fullText, outputFile);
  chapterPartFiles.push(outputFile);
  chapterChunkBuffer = [];
}

async function finalizeCurrentChapter() {
  await flushParagraphBuffer();

  if (!shouldAccumulateChapterAudio()) {
    return;
  }

  if (FLAGS.GenerateChapterAudioFiles) {
    await flushChapterChunkBuffer();

    if (chapterPartFiles.length > 0) {
      const finalOutputFile = buildChapterFilePath(chapterIndex, currentChapterTitle);
      console.log(`[MERGE CHAPTER] ${currentChapterTitle} -> ${finalOutputFile}`);

      try {
        await mergeAudioFiles(chapterPartFiles, finalOutputFile);

        if( !FLAGS.KeepPartFiles ) {
          for (const file of chapterPartFiles) {
            try { fs.unlinkSync(file); } catch (_) {}
          }
        }
      } catch (err) {
        console.error(
          `Merge error for chapter "${currentChapterTitle}": ${err.message}`
        );
        console.error(`Keeping part files in ${path.join(FLAGS.OutputDir, "_parts")}`);
      }
    }

    chapterPartFiles = [];
    chapterChunkBuffer = [];
    chapterBuffer = [];
    return;
  }

  if (FLAGS.GroupFullChapter) {
    await flushChapterBuffer(chapterBuffer, currentChapterTitle, chapterIndex);
    chapterBuffer = [];
  }
}

// =====================================================
// MAIN EXECUTION
// =====================================================
async function main() {
  const inputFile = process.argv[2];
  let seenFirstChapter = false;
  let started = FLAGS.StartAfterLine === 0;
  // Buffers for chapter grouping
  chapterBuffer = [];
  currentChapterTitle = "";
  chapterIndex = 0;
  // Reset paragraph buffer at the start of main execution
  paragraphBuffer = [];
  // Buffers for audio file generation initialization
  chapterChunkBuffer = [];
  chapterPartFiles = [];

  console.log(`[VOICE=${FLAGS.SayVoice} RATE=${FLAGS.SayRate}]\n`);

  if (!inputFile) {
    console.error("Usage: node parseBookCli.js <input-file>");
    process.exit(1);
  }

  const fullPath = path.resolve(inputFile);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: file not found: ${fullPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(fullPath, "utf8");

  const items = ParserLib.parseBook(text, {
    EmptyLinesText: `[[slnc ${FLAGS.StandardPause}]]`,
  });

  const counts = ParserLib.getCounts(items);

  for (const item of items) {
    // Update current chapter context for StartAfterLine logic
    if ( item.type === "chapter" &&
          typeof FLAGS.StartAfterLine === "number" &&
          item.lineNumber < FLAGS.StartAfterLine )
    {
      currentChapterTitle = item.text;
    }

    if (!started) {
      if (hasReachedStartTarget(item)) {
        console.log(`--- Starting from ${FLAGS.StartAfterLine} ---`);
        started = true;

        if (shouldAccumulateChapterAudio()) {
          currentChapterTitle = currentChapterTitle || "Partial Chapter";
          chapterBuffer = [];
          chapterChunkBuffer = [];
          chapterPartFiles = [];
        }
      } else {
        continue;
      }
    }

    if (item.type === "param") {
      await flushParagraphBuffer();

      const speechSettingChanged = isSpeechSettingParameterName(item.name);

      if (FLAGS.GenerateChapterAudioFiles && speechSettingChanged) {
        await flushChapterChunkBuffer();
      }

      applyParameterToFlags(item);
      // Dynamic StartAfterLine handling
      started = checkForStartTargetChange(started, item);

      continue;
    }

    if (item.type === "chapter") {
      await flushParagraphBuffer();
      if (FLAGS.LogChapterTitle) {
        console.log(`[CHAPTER]    line ${item.lineNumber}: ${item.text}`);
      }

      if (shouldAccumulateChapterAudio()) {
        if (seenFirstChapter) {
          await finalizeCurrentChapter();
        }

        chapterIndex += 1;
        currentChapterTitle = item.text;
        seenFirstChapter = true;

        // Optional: include chapter title in spoken text
        pushChapterContent(item.text);
      } else {
        await consoleLogger("chapter", `[CHAPTER]    line ${item.lineNumber}: ${item.text}`, item);
      }

      continue;
    }

    if (item.type === "section") {
      await flushParagraphBuffer();
      if (FLAGS.LogSectionTitle) {
        console.log(`[SECTION]    line ${item.lineNumber}: ${item.text}`);
      }

      if (shouldAccumulateChapterAudio()) {
        pushChapterContent(`Section. ${item.text}.`);
      } else {
        await consoleLogger("section", `[SECTION]    line ${item.lineNumber}: ${item.text}`, item);
      }

      continue;
    }

    if (item.type === "subsection") {
      await flushParagraphBuffer();
      if (FLAGS.LogSubSectionTitle) {
        console.log(`[SUBSECTION] line ${item.lineNumber}: ${item.text}`);
      }

      if (shouldAccumulateChapterAudio()) {
        pushChapterContent(item.text);
      } else {
        await consoleLogger("subsection", `[SUBSECTION] line ${item.lineNumber}: ${item.text}`, item);
      }

      continue;
    }

    if (item.type === "text") {
      if (FLAGS.GroupConsecutiveTextIntoParagraphs) {
        paragraphBuffer.push({
          text: item.text,
          lineNumber: item.lineNumber
        });
      } else {
        if (FLAGS.LogTextFull) {
          console.log(`[TEXT FULL]  line ${item.lineNumber}: ${item.text}`);
        } else if (FLAGS.LogTextInitial) {
          console.log(`[TEXT]       line ${item.lineNumber}: ${ParserLib.previewText(item.text)}`);
        }

        if (shouldAccumulateChapterAudio()) {
          pushChapterContent(item.text);
        } else {
          await consoleLogger(
            "text",
            FLAGS.LogTextFull
              ? `[TEXT FULL]  line ${item.lineNumber}: ${item.text}`
              : `[TEXT]       line ${item.lineNumber}: ${ParserLib.previewText(item.text)}`,
            item
          );
        }
      }
    }
  }

  await flushParagraphBuffer();

  if (shouldAccumulateChapterAudio()) {
    await finalizeCurrentChapter();
  }

  console.log("");
  console.log(`Parsed ${counts.total} items total.`);
  console.log(
    `Chapters: ${counts.chapters}, ` +
    `Sections: ${counts.sections}, ` +
    `Subsections: ${counts.subsections}, ` +
    `Text lines: ${counts.textLines}`
  );
}

main();