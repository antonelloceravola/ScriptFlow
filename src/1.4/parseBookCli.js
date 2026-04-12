#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ParserLib = require("./parserLib.js");

// Load configuration and presets
const {
  FLAGS,
  RatesPresets,
  NarratorPresets,
  HeadingPrefixes,
  getPauseTag
} = require("./config.js");
const { exit } = require("process");

let pendingPausePrefix = "";
// Extend flags with derived parameters
function updateFLAGS(optionName, newValue) {
  let result = false
  // Log voices: say -v "?"
  // Voice Parameters (for "say" command on macOS)
  if( optionName === "Language" ) {
    newValue = (newValue || FLAGS.Language || "").trim();
    if( NarratorPresets[newValue] && HeadingPrefixes[newValue] ) {
      FLAGS.Language = newValue;
      FLAGS.SayVoice = NarratorPresets[newValue].Narrator.voice;
      FLAGS.SayRate = NarratorPresets[newValue].Narrator.rate;
      result = true;
    }
  } else if( optionName === "Mode" || optionName === "Rate" ) {
    const mode = RatesPresets[newValue] || null;
    if (mode) {
      FLAGS.SayRate = mode.rate;
      result = true;
    }
  } else if( optionName === "Narrator" ) {
    const narrator = NarratorPresets[FLAGS.Language][newValue] || null;
    if (narrator) {
      FLAGS.SayVoice = narrator.voice;
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
  } else if( optionName === "Pause" ) {
    newValue = Number(newValue) || 1000;
    pendingPausePrefix = getPauseTag(newValue);
    //const pauseTag = getPauseTag(newValue);
    //pushChapterContent(pauseTag);
    result = true;
  }
  return result;
}
updateFLAGS("Language");

function isSpeechSettingParameterName(name) {
  return name === "Mode" ||
         name === "SayVoice" ||
         name === "SayRate" ||
         name === "Language" ||
         name === "Narrator" ||
         name === "Pause";
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
      "-b:a", String(FLAGS.FinalAudioBitrate || "192k"),
      "-af","adelay=500,loudnorm"
    );
  } else {
    ffmpegArgs.push("-c", "copy");
  }

  ffmpegArgs.push(outputFile);

  if( FLAGS.LogSayCommands ) {
    console.log(`[FFMPEG COMMAND] ffmpeg ${ffmpegArgs.map(a => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
  }

  await new Promise((resolve, reject) => {
    const logObj = (FLAGS.ShowAudioMergingLogs? { stdio: "inherit" }: undefined);
    const child = spawn("ffmpeg", ffmpegArgs, logObj);

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

// This function is used in case you call
// the script with --doMerge option to 
// merge existing part files
async function mergeExistingParts() {
  const partsDir = path.join(FLAGS.OutputDir, "_parts");

  if (!fs.existsSync(partsDir)) {
    console.error("No _parts directory found.");
    return;
  }

  const files = fs.readdirSync(partsDir)
    .filter(f => f.endsWith(".aiff"))
    .sort();

  if (files.length === 0) {
    console.error("No part files found.");
    return;
  }

  // Group by chapter prefix (e.g. "01-title")
  const groups = {};

  for (const file of files) {
    const match = file.match(/^(.*)\.part\d+\.aiff$/);
    if (!match) continue;

    const key = match[1];

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(path.join(partsDir, file));
  }

  for (const key of Object.keys(groups)) {
    const partFiles = groups[key].sort();

    const outputFile = path.join(
      FLAGS.OutputDir,
      `${key}.${getFinalAudioExtension()}`
    );

    console.log(`[MERGE ONLY] ${key} -> ${outputFile}`);

    try {
      await mergeAudioFiles(partFiles, outputFile);

      if (!FLAGS.KeepPartFiles) {
        for (const f of partFiles) {
          try { fs.unlinkSync(f); } catch (_) {}
        }
      }

    } catch (err) {
      console.error(`Error merging ${key}: ${err.message}`);
    }
  }
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

function getItemPrefix(type, item) {
  let prefix = "";
  const headingPrefix = HeadingPrefixes[FLAGS.Language]?.[type];

  if( headingPrefix && !item.text.toLowerCase().trim().startsWith(headingPrefix.toLowerCase()) ) {
    switch (type) {
      case "text": break;
      case "chapter": 
      case "section":
      case "subsection":
        const pauseTag = getPauseTag(FLAGS.ShortPause);
        prefix = ( headingPrefix || type )+ pauseTag;
        break;
    }
  }
  return prefix;
}

async function consoleLogger(type, message, item) {

  if (FLAGS.SpeakText ) {
    const prefix = getItemPrefix(type, item);
    try {
      await speakText(`${prefix}${item.text}`);
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
    text: pendingPausePrefix? `${pendingPausePrefix}${textBlock}`: textBlock,
    lineNumber: firstLineNumber
  };
  pendingPausePrefix = "";

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

      if(!FLAGS.SkipMerging) {
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

async function parseCommandLineParameters(cliArgs) {
  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === "--listVoices") {
      await listVoices();
      process.exit(0);
    }

    if (arg === "--start" && cliArgs[i + 1]) {
      const value = cliArgs[i + 1];
      FLAGS.StartAfterLine = convertFlagValue(value, FLAGS.StartAfterLine, "StartAfterLine");
      i++; // skip next
      continue;
    }

    if (arg === "--audioFormat" && cliArgs[i + 1]) {
      const value = cliArgs[i + 1];
      FLAGS.FinalAudioFormat = convertFlagValue(value, FLAGS.FinalAudioFormat, "FinalAudioFormat");
      i++; // skip next
      continue;
    }

    if (arg === "--doMerge") {
      if(cliArgs[i + 1]) {
        // Get the output directory for merging
        const value = cliArgs[i + 1];
        FLAGS.OutputDir = convertFlagValue(value, FLAGS.OutputDir, "OutputDir");
        i++; // skip next
      }
      FLAGS.DoMergeOnly = true;
      continue;
    }

    if (!FLAGS.InputFile) {
      FLAGS.InputFile = arg;
      continue;
    }
  }
}

async function listVoices() {
  await new Promise((resolve, reject) => {
    console.log("Available voices:");
    const child = spawn("say", ["-v", "?"], { stdio: "inherit" });

    child.on("error", (err) => {
      console.error(`Error listing voices: ${err.message}`);
    });
    child.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`listing voices with code ${code}`));
      }
    });
  });
}

// =====================================================
// MAIN EXECUTION
// =====================================================
async function main() {
  //const inputFile = process.argv[2];
  const cliArgs = process.argv.slice(2);
  await parseCommandLineParameters(cliArgs);

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
  // Pending pause prefix initialization
  pendingPausePrefix = "";

  if (FLAGS.DoMergeOnly) {
    console.log("--- MERGE ONLY MODE ---");
    await mergeExistingParts();
    console.log("Merge completed.");
    return;
  }

  console.log(`[VOICE=${FLAGS.SayVoice} RATE=${FLAGS.SayRate}]\n`);

  if (!FLAGS.InputFile) {
    console.error("Usage: node parseBookCli.js <input-file>");
    process.exit(1);
  }

  let fullPath = path.resolve(FLAGS.InputFile);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: file not found: ${fullPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(fullPath, "utf8");

  const items = ParserLib.parseBook(text, {
    EmptyLinesText: getPauseTag(FLAGS.StandardPause),
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
        pushChapterContent(item.text);
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
        let effText = item.text;
        if (pendingPausePrefix) {
          effText = `${pendingPausePrefix}${effText}`;
          pendingPausePrefix = "";
        }

        paragraphBuffer.push({
          text: effText,
          lineNumber: item.lineNumber
        });

      } else {
        let effText = item.text;
        if (pendingPausePrefix) {
          effText = `${pendingPausePrefix}${effText}`;
          pendingPausePrefix = "";
        }
        const effItem = {
          ...item,
          text: effText
        };

        if (FLAGS.LogTextFull) {
          console.log(`[TEXT FULL]  line ${effItem.lineNumber}: ${effItem.text}`);
        } else if (FLAGS.LogTextInitial) {
          console.log(`[TEXT]       line ${effItem.lineNumber}: ${ParserLib.previewText(effItem.text)}`);
        }

        if (shouldAccumulateChapterAudio()) {
          pushChapterContent(effItem.text);
        } else {
          await consoleLogger(
            "text",
            FLAGS.LogTextFull
              ? `[TEXT FULL]  line ${effItem.lineNumber}: ${effItem.text}`
              : `[TEXT]       line ${effItem.lineNumber}: ${ParserLib.previewText(effItem.text)}`,
            effItem
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