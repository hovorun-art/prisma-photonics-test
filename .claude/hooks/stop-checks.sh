#!/bin/bash
# Single Stop entry point so the order is deterministic: tests first, then the
# OpenSpec verifier (a verdict is only meaningful on code that passes its tests).
input=$(cat)
dir=$(dirname "$0")
out=$(echo "$input" | "$dir/run-tests.sh")
if [ -n "$out" ]; then echo "$out"; exit 0; fi
echo "$input" | "$dir/verify-change.sh"
