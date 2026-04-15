// Vocal House Chords - Soulful Pattern
// Genre: House | Key: Dm | BPM: 122 | Energy: 7/10
// Source: Soulful house with vocal pads

setcpm(122/4)

const chords = "<Dm Am Bb F>/2"

stack(
  // Vocal pad
  chord(chords).anchor("c4").voicing()
    .s("gm_choir_aahs").gain(0.6).room(1),

  // Piano stabs
  chord(chords).anchor("c5").voicing()
    .s("piano").struct("~ x ~ x").gain(0.8),

  // House bass
  chords.rootNotes(2).struct("x*2")
    .s("gm_synth_bass_1").lpf(500).gain(1),

  // Classic house drums
  s("[bd!2 ~ bd]*2").bank("RolandTR909").gain(.8),
  s("[~ sd]*2").bank("RolandTR909").gain(.6),
  s("oh*4").bank("RolandTR909").gain(.15)
).room(0.3)
