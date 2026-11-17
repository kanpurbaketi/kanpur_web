#!/bin/bash
# parallel, resumable download of the TripoSR weights (the connection is slow and drops)
cd "$(dirname "$0")/weights"
URL="https://huggingface.co/stabilityai/TripoSR/resolve/main/model.ckpt"
SIZE=$(curl -sIL "$URL" | tr -d '\r' | awk 'tolower($1)=="content-length:"{s=$2} END{print s}')
echo "size $SIZE"
N=8; PART=$(( (SIZE + N - 1) / N ))
for i in $(seq 0 $((N-1))); do
  (
    s=$(( i * PART )); e=$(( s + PART - 1 )); [ $e -ge $SIZE ] && e=$(( SIZE - 1 ))
    f=part$i; want=$(( e - s + 1 ))
    for t in $(seq 1 200); do
      have=$(stat -f%z $f 2>/dev/null || echo 0)
      [ "$have" -ge "$want" ] && break
      curl -sL --max-time 600 -r $(( s + have ))-$e "$URL" >> $f
    done
  ) &
done
wait
cat part0 part1 part2 part3 part4 part5 part6 part7 > model.ckpt
echo "assembled $(stat -f%z model.ckpt) of $SIZE"
