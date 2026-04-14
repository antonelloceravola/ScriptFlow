#!/bin/bash

if [ $# -eq 0 ] || [ "$1" = "--help" ]; then
  echo "Usage:"
  echo "  $(basename "$0") <input-file> [options]"
  echo ""
  echo "Examples:"
  echo "  $(basename "$0") book.txt"
  echo "  $(basename "$0") book.txt --start 100"
  echo "  $(basename "$0") --doMerge"
  echo "  $(basename "$0") --listVoices"
  echo ""
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/src/1.4/parseBookCli.js" "$@"