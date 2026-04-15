samples('github:eddyflux/crate')
setcps(.75)

let chords = chord("<Bbm9 Fm9>/4").dict('ireal')

stack(
  //CHORDS
  chords.offset(-1).voicing().s("gm_epiano1:1")
    .phaser(4).room(.5)
    .color("cyan")
    ._punchcard(),


  //DRUM
  stack(
    s("bd"), struct("<[x*2 [~@3 x]] x>"),
    s("~ sd").room(.2),
    n("[0 <1 3>] *<2!3 4>").s("hh")
  )
    .bank("crate")
    .color("magenta")
    ._punchcard(),


  // BASS
  n("<0!3 1x2>").set(chords).mode("roor:g2")
    .voicing().s("gm_acoustic_bass")
    .gain(.9)
)
  .late("[0, .01]*4")
  .size(4)