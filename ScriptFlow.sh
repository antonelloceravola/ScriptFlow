#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/src/1.4/parseBookCli.js" "$@"