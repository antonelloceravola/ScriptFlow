(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ParserLib = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isBlank(line) {
    return line.trim() === "";
  }

  function isComment(line) {
    return line.trim().startsWith("// ");
  }

  function parseCommentParameter(line) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("// ")) {
      return null;
    }

    const content = trimmed.slice(3).trim();

    // Matches: Name: value
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) {
      return null;
    }

    return {
      name: match[1],
      value: match[2]
    };
  }

  function hasNoSpaceAfterMarker(line, marker) {
    return line.startsWith(marker) && line.length > 1 && line[1] !== " ";
  }

  function isDelimitedTitle(lines, index, marker) {
    const current = lines[index];

    if (!hasNoSpaceAfterMarker(current, marker)) {
      return false;
    }

    const prevBlank = index > 0 && isBlank(lines[index - 1]);
    const nextBlank = index < lines.length - 1 && isBlank(lines[index + 1]);

    return prevBlank && nextBlank;
  }

  function flushParagraphBuffer(items, buffer, startLineNumber) {
    if (buffer.length === 0) {
      return;
    }

    items.push({
      type: "text",
      raw: buffer.join("\n"),
      text: buffer.join("\n").replace(/\n{3,}/g, "\n\n"), //(" "),
      lineNumber: startLineNumber,
    });

    buffer.length = 0;
  }
  
  function getTitleText(line) {
    return line.slice(1).trim();
  }

  function previewText(text, maxLen = 20) {
    return text.length <= maxLen ? text : text.slice(0, maxLen);
  }

  function normalizeText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function parseBook(text, options = {}) {
    const normalized = normalizeText(text);
    const lines = normalized.split("\n");
    const items = [];

    const groupParagraphs = (options.GroupConsecutiveTextIntoParagraphs !== undefined)?
                              options.GroupConsecutiveTextIntoParagraphs : false;
    const emptyLinesText = (options.EmptyLinesText? options.EmptyLinesText: "");

    let paragraphBuffer = [];
    let paragraphStartLine = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Comments MUST be ignored as first pre-processing step
      if (isComment(line)) {
        const param = parseCommentParameter(line);

        if (param) {
          items.push({
            type: "param",
            name: param.name,
            value: param.value,
            raw: line,
            text: line,
            lineNumber: i + 1
          });
        }

        continue;
      }

      // Blank line are used to merge paragraphs
      if (isBlank(line)) {
        if (groupParagraphs && paragraphBuffer.length > 0) {
          // Keep paragraph continuity, but preserve spacing
          paragraphBuffer.push(emptyLinesText);
        }
        continue;
      }

      // Titles also close an open paragraph block first
      if (isDelimitedTitle(lines, i, "*")) {
        if (groupParagraphs) {
          flushParagraphBuffer(items, paragraphBuffer, paragraphStartLine);
          paragraphStartLine = null;
        }

        items.push({
          type: "chapter",
          raw: line,
          text: getTitleText(line),
          lineNumber: i + 1,
        });
        continue;
      }

      if (isDelimitedTitle(lines, i, "-")) {
        if (groupParagraphs) {
          flushParagraphBuffer(items, paragraphBuffer, paragraphStartLine);
          paragraphStartLine = null;
        }

        items.push({
          type: "section",
          raw: line,
          text: getTitleText(line),
          lineNumber: i + 1,
        });
        continue;
      }

      if (isDelimitedTitle(lines, i, ":")) {
        if (groupParagraphs) {
          flushParagraphBuffer(items, paragraphBuffer, paragraphStartLine);
          paragraphStartLine = null;
        }

        items.push({
          type: "subsection",
          raw: line,
          text: getTitleText(line),
          lineNumber: i + 1,
        });
        continue;
      }

      // Normal text
      if (groupParagraphs) {
        if (paragraphBuffer.length === 0) {
          paragraphStartLine = i + 1;
        }
        paragraphBuffer.push(line.trim());
      } else {
        items.push({
          type: "text",
          raw: line,
          text: line,
          lineNumber: i + 1,
        });
      }
    }

    if (groupParagraphs) {
      flushParagraphBuffer(items, paragraphBuffer, paragraphStartLine);
    }

    return items;
  }

  function getCounts(items) {
    return {
      total: items.length,
      chapters: items.filter(item => item.type === "chapter").length,
      sections: items.filter(item => item.type === "section").length,
      subsections: items.filter(item => item.type === "subsection").length,
      textLines: items.filter(item => item.type === "text").length,
    };
  }

  function processBook(text, options = {}) {
    const flags = options.flags || {};

    const items = parseBook(text, {
      GroupConsecutiveTextIntoParagraphs: !!flags.GroupConsecutiveTextIntoParagraphs,
    });
    const counts = getCounts(items);
    const logger = typeof options.logger === "function" ? options.logger : null;

    if (logger) {
      for (const item of items) {
        if (item.type === "chapter" && flags.LogChapterTitle) {
          logger("chapter", `[CHAPTER]    line ${item.lineNumber}: ${item.text}`, item);
          continue;
        }

        if (item.type === "section" && flags.LogSectionTitle) {
          logger("section", `[SECTION]    line ${item.lineNumber}: ${item.text}`, item);
          continue;
        }

        if (item.type === "subsection" && flags.LogSubSectionTitle) {
          logger("subsection", `[SUBSECTION] line ${item.lineNumber}: ${item.text}`, item);
          continue;
        }

        if (item.type === "text") {
          if (flags.LogTextFull) {
            logger("text", `[TEXT FULL]  line ${item.lineNumber}: ${item.text}`, item);
          } else if (flags.LogTextInitial) {
            logger("text", `[TEXT]       line ${item.lineNumber}: ${previewText(item.text)}`, item);
          }
        }
      }
    }

    return { items, counts };
  }

  return {
    isBlank,
    hasNoSpaceAfterMarker,
    isDelimitedTitle,
    getTitleText,
    previewText,
    parseBook,
    getCounts,
    processBook,
  };
});