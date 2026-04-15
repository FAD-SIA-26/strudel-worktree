export const melody = note(`
  <
    [0 2 4 5 4 2 0 -] [0 2 4 6 5 4 2 -]
    [7 6 4 2 0 2 4 -] [5 4 2 3 2 0 - -]
  >
`)
  .scale("d4:minor")
  .s("supersaw")
  .release(0.18)
  .legato(1.05)
  .detune(0.18)
  .lpf(1850)
  .delay(0.28)
  .delaytime(0.34)
  .delayfeedback(0.3)
  .room(0.72)
  .gain(0.5);
