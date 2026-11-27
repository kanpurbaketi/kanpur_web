#!/bin/bash
# out/gen/<n> (in the order of out/gen_list.txt) -> out/glb/<name>.glb with previews
cd "$(dirname "$0")"
B=/Applications/Blender.app/Contents/MacOS/Blender
i=0
while read -r f; do
  name=$(basename "$f" .jpg)
  case $name in
    auto*) size="1.35 2.65 1.75";; bike*) size="0.75 2.0 1.1";; bus*) size="2.6 9.6 3.1";;
    maruti*) size="1.44 3.34 1.41";; tirri*) size="1.0 2.8 1.78";;
  esac
  extra=""; [ -f "out/flags/$name" ] && extra=$(cat "out/flags/$name")
  $B -b -P convert.py -- out/gen/$i out/glb/$name.glb --size $size --preview out/glb/prev $extra 2>&1 | grep -E "MODEL|Error|Traceback"
  i=$((i+1))
done < out/gen_list.txt
