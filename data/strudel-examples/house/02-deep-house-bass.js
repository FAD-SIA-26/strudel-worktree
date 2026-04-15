// Deep House Bass - Rhythm of the Night Style
// Genre: House | Key: Ab | BPM: 128 | Energy: 7/10
// Source: Rhythm of the Night inspired arrangement

setcpm(128/4)

const crdpart = "<Ab Cm Bb F@2>".slow(5)

stack(
  // Chord progression
  crdpart.chord().anchor("F4").voicing()
    .s("gm_synth_strings_1").gain(0.4),

  // Synth bass
  "2 ~@2 2 ~@2 2 ~@3 2 ~@3 2 ~"
    .n().chord(crdpart).anchor(crdpart.rootNotes(2)).voicing()
    .s("gm_synth_bass_1").lpf(1500).room(0.5).gain(0.9),

  // House drums
  stack(
    s("bd*4").gain(0.8),
    s("[~ oh]*4").gain(0.14),
    s("hh*16").gain(0.09),
    s("[~ cp]*2").gain(0.4)
  ).bank("RolandTR909").room(0.2).velocity(1)
).room(0.3)
