(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ParserLib = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // =====================================================
  // LOG FLAGS
  //
  // Flags can be set by
  // a line like: // StartAfterLine: 10
  // a line like: // Language: En2
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
    ShowAudioMergingLogs: false,

    // Speech options
    Language: "En1", // "En1", "It1"

    // Pause durations (in milliseconds)
    ShortPause: 400,
    StandardPause: 600,
    LongPause: 1000
  };

  // =====================================================
  // Speaking RATES PRESETS
  //
  // Rate can be set by
  // a line like: // Mode: Slow
  // =====================================================
  const RatesPresets = {
    VerySlow:   { rate:  30 },
    Slow:       { rate: 115 },
    Calm:       { rate: 135 },
    Reflective: { rate: 150 },
    Neutral:    { rate: 165 },
    Fast:       { rate: 200 },
    VeryFast:   { rate: 230 },
    Intense:    { rate: 260 },
    Gentle:     { rate: 130 }
  };

  // =====================================================
  // Speaking VOICES PRESETS BY LANGUAGE
  //
  // Make sure to download the voices you want to use 
  // in your system settings, and update the voice names 
  // here if needed.
  // =====================================================
  const NarratorPresets = {
    En0: {
      "Narrator":   { voice: "Lee",     rate: "Neutral" },
      "Boy":        { voice: "Nathan",  rate: "Neutral" },
      "Girl":       { voice: "Joelle",  rate: "Neutral" },
      "Serious":    { voice: "Nathan",    rate: "Neutral" },
    },
    En1: {
      "Narrator":   { voice: "Lee",     rate: "Neutral" },
      "Boy":        { voice: "Nathan",  rate: "Neutral" },
      "Girl":       { voice: "Joelle",  rate: "Neutral" },
      "Serious":    { voice: "Nathan",    rate: "Neutral" },
    },
    En2: {
      "Narrator":   { voice: "Zoe",     rate: "Neutral" },
      "Boy":        { voice: "Nathan",  rate: "Neutral" },
      "Girl":       { voice: "Ava",     rate: "Neutral" },
      "Serious":    { voice: "Kate",    rate: "Neutral" },
    },
    It0: {
      "Narrator":   { voice: "Emma",    rate: "Neutral" },
      "Boy":        { voice: "Luca",    rate: "Neutral" },
      "Girl":       { voice: "Paola",   rate: "Neutral" },
      "Serious":    { voice: "Alice",   rate: "Neutral" },
    },
    It1: {
      "Narrator":   { voice: "Emma",    rate: "Neutral" },
      "Boy":        { voice: "Luca",    rate: "Neutral" },
      "Girl":       { voice: "Paola",   rate: "Neutral" },
      "Serious":    { voice: "Alice",   rate: "Neutral" },
    }
  };

  // =====================================================
  // HEADING PREFIXES BY LANGUAGE
  // =====================================================
  const HeadingPrefixes = {
    En0: {
      chapter:    "",
      section:    "",
      subsection: ""
    },
    En1: {
      chapter:    "Chapter",
      section:    "Section",
      subsection: "Subsection"
    },
    En2: {
      chapter:    "Chapter",
      section:    "Section",
      subsection: "Subsection"
    },
    It0: {
      chapter:    "",
      section:    "",
      subsection: ""
    },
    It1: {
      chapter:    "Capitolo",
      section:    "Sezione",
      subsection: "Sottosezione"
    }
  };

  function getPauseTag(elapsedTime) {
    return `[[slnc ${elapsedTime}]]`;
  }

  return {
    FLAGS,
    RatesPresets,
    NarratorPresets,
    HeadingPrefixes,
    getPauseTag
  };
});