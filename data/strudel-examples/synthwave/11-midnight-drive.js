// Neon Skyline
// Close inspiration: cyberpunk + Stranger Things style arrangement
// Theme: synthwave / retro-futuristic night drive

setcpm(86 / 4)

// DRUMS
const kick = s("bd!4")
  .gain(1.05)
  .duckorbit(2)
  .duckattack(.22)

const snare = s("- sd:4 - sd:4")
  .orbit(2)
  .gain(.9)

const hihat = s("hh!8:2")
  .orbit(2)
  .gain(.4)

const openHat = s("~ oh ~ oh")
  .orbit(2)
  .gain(.22)

const clap = s("~ cp ~ cp")
  .orbit(2)
  .gain(.2)

$DRUMS: stack(kick, snare, hihat, openHat, clap)
  .mask("<0@8 1@24>")
  ._scope()

// INTRO ATMOSPHERE
const openingPad = note("<[f2,a2,c3] [d#2,g2,a#2] [c2,e2,g2] [a#1,d2,f2]>")
  .sound("gm_pad_warm:6")
  .trans(12)
  .gain(.28)
  .vib(1)
  .vibmod(".22")
  .lpf(380)

const openingFx = note("[0 2 4 7 9 7 4 2]*2")
  .scale("f5:minor")
  .sound("zzfx")
  .gain(.02)

$OPENING: stack(openingPad, openingFx)
  .mask("<1@8 0@24>")
  .room(4)
  .rsize(6)
  ._pianoroll()

// HEARTBEAT SUB PULSE
$HEART_BEAT: sound("[bd:6 ~ ~ ~]*4")
  .mask("<1@8 0@24>")
  .gain(.75)
  ._scope()

// BASS OSTINATO
$BASS: note("f2 c2!3 d#2!2 c2!3 a#1 c2")
  .sound("gm_synth_bass_1:9")
  .lpf(perlin.slow(6).range(120, 900))
  .gain(.95)
  .mask("<0@8 1@24>")
  ._pianoroll()

// WIDE ANALOG CHORD BED
$CHORDS: note("<[f3,c4,f4] [d#3,a#3,d#4] [c3,g3,c4] [a#2,f3,a#3]>")
  .sound("gm_synth_brass_2:4")
  .trans(-12)
  .gain(.75)
  .room(.9)
  .rsize(5)
  .mask("<0@4 1@28>")
  ._pianoroll()

// DRIVING ARP
$ARP: note("<[f5 c6 f6 a#6]*2 [d#5 a#5 d#6 g6]*2 [c5 g5 c6 d#6]*2 [a#4 f5 a#5 d6]*2>")
  .trans(-12)
  .s("sawtooth")
  .orbit(2)
  .distort(0.45)
  .lpenv(perlin.slow(3).range(1, 5))
  .lpf(perlin.slow(2).range(180, 2800))
  .gain(0.28)
  .room(.8)
  .rsize(6)
  .mask("<0@12 1@20>")
  ._pianoroll()

// MAIN LEAD
$LEAD: note(`<
    ~@4
    c5@0.5 d#5@0.5 f5@1
    g5@0.5 f5@0.5 d#5@1
    c5@0.5 a#4@0.5 c5@1
    d#5@0.5 c5@0.5 a#4@1
  >`)
  .sound("gm_lead_8_bass_lead")
  .gain(.58)
  .room(.85)
  .rsize(6)
  .mask("<0@16 1@8 0@8>")
  ._pianoroll()

// SUPPORT / SECONDARY HOOK
$COUNTER: note(`<
    ~@8
    [c4 f4]@1 [d#4 g4]@1
    [c4 g4]@1 [a#3 f4]@1
    [c4 f4]@1 [d#4 g4]@1
    [f4 a#4]@1 [g4 c5]@1
  >`)
  .sound("supersaw")
  .detune(".2")
  .gain(.22)
  .lpf(1400)
  .room(.7)
  .rsize(4)
  .mask("<0@16 1@16>")
  ._pianoroll()

// OPTIONAL HIGH SHIMMER
$SHIMMER: note("<f6 ~ c6 ~ d#6 ~ c6 ~>*2")
  .sound("gm_flute:3")
  .gain(.12)
  .room(1.8)
  .rlp(4500)
  .mask("<0@20 1@12>")
  ._pianoroll()
