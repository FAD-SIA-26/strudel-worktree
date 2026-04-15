
// https://youtube.com/@farhankk360
// Cyber punk style

// I am also working on a full version, stay tuned and subscribe.

setcpm(90 / 4)

const kick = s("bd!4:6").duckorbit(2).duckattack(.25)
const snare = s("- sd:4 - sd:4")
const hihat = s("hh!8:1").orbit(2).gain(.5)

$DRUMS: stack(kick, snare, hihat)._scope()
$SYNTH: note("f2 d2!6 d#2!3 d2!5 d1")
  .s("supersaw")
  .orbit(2)
  ._pianoroll()

$CHORDS: note("<[a#3,a#4] [g3,g4] [d3,d4]@2>")
  .s("gm_synth_brass_2")
  .orbit(2)
  .trans(-12)
  .room(.8)
  .rsize(4)
  ._pianoroll()

$LEAD: note("<d4@0.75 f4@0.25 e4@0.5 a#4@0.25 a4@0.25 -@2>")
  .orbit(2)
  .s("gm_lead_8_bass_lead")
  .gain(.6)
  .room(.8)
  .rsize(6)
  ._pianoroll()
$ARP: note("<[d5 a5 a#5 d6]*4 [[d5 a5 a#5 f6] [d5 a5 a#5 e6]]*2>")
  .trans(-12)
  .s("sawtooth")
  .orbit(2)
  .distort(0.5)
  .lpenv(perlin.slow(3).range(1, 5))
  // .lpf(slider(1015, 100, 3000, 1))
  .lpf(perlin.slow(2).range(100, 3000))
  .gain(0.3)
  .room(.8)
  .rsize(6)
  ._pianoroll()