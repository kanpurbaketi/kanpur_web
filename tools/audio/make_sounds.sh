#!/bin/sh
# The game's recorded sounds (public/audio), cut from Freesound CC0 recordings (their hq previews, downloaded into
# assets/audio_raw/<id>.mp3: tools/audio/freesound.py <id>...). Each trimmed, its leading silence cut, faded, loudness-
# matched; public/audio/CREDITS.md lists where each came from.
#   sh tools/audio/make_sounds.sh
set -e
R=assets/audio_raw; O=public/audio
# clip <out> <id> <start> <len> <fade in> <fade out> <LUFS> <channels> [extra filters]
clip() {
  out=$1 id=$2 ss=$3 len=$4 fi=$5 fo=$6 lufs=$7 ch=$8 extra=${9:-anull}
  st=$(python3 -c "print(max(0, $len - $fo))")
  br=$([ "$ch" = 1 ] && echo 80k || echo 112k)
  shape="$extra,afade=t=in:d=$fi,afade=t=out:st=$st:d=$fo"
  if python3 -c "import sys; sys.exit(0 if $len < 1.2 else 1)"; then
    # too short for a loudness measure: its mean level put at the LUFS figure (as dB), its peaks limited to -2 dB
    mean=$(ffmpeg -v info -ss "$ss" -t "$len" -i "$R/$id.mp3" -ac "$ch" -af "$shape,volumedetect" -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*' | cut -d' ' -f2)
    ffmpeg -v error -y -ss "$ss" -t "$len" -i "$R/$id.mp3" -ac "$ch" -ar 44100 -af "$shape,volume=$(python3 -c "print($lufs - ($mean))")dB,alimiter=limit=0.79:attack=1:release=40:level=0" -b:a $br "$O/$out"
  else
    ffmpeg -v error -y -ss "$ss" -t "$len" -i "$R/$id.mp3" -ac "$ch" -ar 44100 -af "$shape,loudnorm=I=$lufs:TP=-1.5:LRA=11" -ar 44100 -b:a $br "$O/$out"
  fi
}
LEAD="silenceremove=start_periods=1:start_threshold=-38dB"
# the story (src/game/story/sfx.ts): played as long as the scene asks, faded out there
clip sfx/applause.mp3 324369 2.0 7.0 0.15 1.2 -16 2
clip sfx/boo.mp3      264378 0.0 7.0 0.25 1.2 -16 2
clip sfx/stomach.mp3  52293  0.0 3.6 0.05 0.4 -18 1 "$LEAD"
clip sfx/thud.mp3     405705 0.0 0.45 0.003 0.15 -19 1 "$LEAD"
# fists (src/main.ts): one picked at random each time a blow lands
clip sfx/punch1.mp3   208791 0.30 0.45 0.003 0.15 -17 1 "$LEAD"
clip sfx/punch2.mp3   208791 1.60 0.45 0.003 0.15 -17 1 "$LEAD"
clip sfx/punch3.mp3   460509 0.30 0.45 0.003 0.15 -17 1 "$LEAD"
clip sfx/punch4.mp3   390462 0.00 0.40 0.003 0.12 -17 1 "$LEAD"
# the revolver (src/player/gun.ts): the shot (two, at random), a bullet into somebody (three), off a wall, cocking it
clip sfx/shot1.mp3    683175 0.0 2.2 0.002 0.8 -13 1 "$LEAD"
clip sfx/shot2.mp3    427592 0.0 1.1 0.002 0.4 -15 1 "$LEAD"
clip sfx/flesh1.mp3   423301 0.05 0.28 0.002 0.08 -18 1 "$LEAD"
clip sfx/flesh2.mp3   423301 0.40 0.28 0.002 0.08 -18 1 "$LEAD"
clip sfx/flesh3.mp3   423301 1.13 0.25 0.002 0.08 -18 1 "$LEAD"
clip sfx/ricochet.mp3 392975 0.0 0.40 0.002 0.12 -20 1 "$LEAD"
clip sfx/cock.mp3     111676 0.0 0.55 0.002 0.1 -20 1 "$LEAD"
# somebody knocked down (src/game/ambience.ts)
clip shout1.mp3       221544 0.0 2.0 0.01 0.3 -16 1 "$LEAD"
clip shout2.mp3       401210 0.0 2.9 0.01 0.4 -16 1 "$LEAD"
clip shout3.mp3       801386 0.0 0.95 0.01 0.2 -18 1 "$LEAD"
ls -l "$O" "$O/sfx" | awk 'NF>5 {print $5, $NF}'
