// The Rhythm Of The Night - Corona
// Genre: House/Eurodance
// BPM: 128
// Key: C Minor
// Source: github:eefano/strudel-songs-collection/rhythmofthenight.js
// Complete eurodance house arrangement with prominent melody and chords

setDefaultVoicings('legacy')
const as = register('as', (mapping, pat) => { mapping = Array.isArray(mapping) ? mapping : [mapping];
  return pat.fmap((v) => { v = Array.isArray(v) ? v : [v, 0];
    return Object.fromEntries(mapping.map((prop, i) => [prop, v[i]])); }); });

const crdpart = "<~ 0@10 1@24 0@19>".pick([
  "Ab Cm Bb F@2".slow(5),
  "Bb@3 Ab@3 Cm@2".slow(8)
]);

stack(
  "<0 1@4 0 1@4 ~@8 2 3@7 2 3@7 0 1@4 0 1@4 0 1@4 0 1@4>".pick([
    "~ [4@3 ~]!3 7:5 6 4 3",
    "2:-1 0:-2 ~@4 6:1 4:-1 6 4:2 ~@4 [4:2 3]@3 ~@6 4 7:5 6 [4@2 ~] [3:-1 2@3]@2 0 ~@2".slow(4),
    "~@6 [6 ~]!2",
    "6 5@0.5 [5 ~] [4 ~]!2 [3 ~] 3:2@1.5 ~@7 6@2 6:2 [5 ~ ]!2 4 3@2 4 2 0:-2 ~@7 [0 2]@3 3@2 4 6:4 4:-4 ~ 0 2 0 4 ~ 0 0:2@2 ~@7".slow(7)
  ]).as("n:penv").scale("c4:minor").patt("0.07").s("gm_lead_1_square").room(0.4).delay(0.3).dfb(0.35).dt(60/128).gain(0.85),

  crdpart.chord().anchor("F4").voicing().s("gm_synth_strings_1").gain(0.4),

  "<~@11 1@23 ~ 0@19>".pick([
    "2 ~@2 2 ~@2 2 ~@3 2 ~@3 2 ~",
    "[2 ~@2 2 ~@2 2 ~]!2"
  ]).n().chord(crdpart).anchor(crdpart.rootNotes(2)).voicing().s("gm_synth_bass_1").lpf(1500).room(0.5).gain(0.9),

  "<~@11 1@8 ~@16 0@19>".pick([
    "<5 7 6 3!2> ~ 9 ~ 10 ~ ~ 12 ~ 11 ~ 10 ~ 11 9 ~",
    "<6!3 5!3 7!2> ~ 9 ~ 10 ~ ~ 12 ~ 11 ~ 10 ~ 11 9 ~"
  ]).scale("c3:minor").note().s("gm_lead_2_sawtooth").room(0.3).delay(0.3).dfb(0.5).dt(60/128*2).gain(0.6),

  "<[2,3] ~@10 0@6 [0,1]@2 [0,2] 0@5 [0,1]@2 [0,2] 0@6 [2,3] 0@8 [0,1]@2 [0,2] 0@8>".pick([
    stack(s("bd*4").gain(0.8),s("[~ oh]*4").gain(0.14),s("hh*16").gain(0.09),s("[~ cp]*2").gain(0.4))
  ]).bank("RolandTR909").room(0.2).velocity(1)
).cpm(128/4)
