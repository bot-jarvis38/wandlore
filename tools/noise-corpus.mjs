/**
 * Things said in front of a live microphone that are not an incantation.
 *
 * A generous match bar is only defensible if this list is genuinely hostile, so
 * it is not just filler words: it includes the long multi-syllable English the
 * recogniser is most likely to return when it mishears made-up Latin, and words
 * that really do rhyme with the spells. Widening the bar without widening this
 * would be marking your own homework.
 *
 * Shared by `score-bench.mjs` and `word-audit.mjs` so that adding a hostile
 * case improves both at once, and so a word added to the spellbook is measured
 * against the same room either tool is run in.
 */
export const NOISE = [
  // filler and reactions
  'what', 'hello', 'come on', 'oh no', 'aaaah', 'shit', 'wait wait wait',
  'i said it', 'the door', 'yeah okay', 'hold on a second', 'is this thing on',
  'ow', 'hang on', 'one more', 'again', 'no no no', 'here we go', 'oh my god',
  'that was close', 'did you see that', 'im dying', 'this is hard',
  // talking to someone else in the room
  'can you pass me that', 'what time is it', 'im on my phone', 'two minutes',
  'put it on the table', 'ill call you back', 'are you coming or not',
  'do you want anything', 'ive nearly finished', 'give me a minute',
  'can you turn that down', 'whats for dinner', 'im just playing a game',
  // long latinate english — what a recogniser reaches for when it gives up
  'expedition', 'inspection', 'accelerate', 'liberation', 'expenditure',
  'penicillin', 'reduction', 'production', 'seriously', 'ridiculous',
  'articulate', 'immaculate', 'peculiar', 'stupendous', 'protective',
  'aluminium', 'delicious', 'suspicious', 'ambitious', 'religious',
  // and more of it, because the bank now reaches into real-sounding words
  'temperature', 'literature', 'refrigerator', 'calculator', 'celebration',
  'demonstration', 'consideration', 'incidentally', 'alternative', 'obliterated',
  'confidential', 'disintegrate', 'unfortunate', 'velocity', 'gravity',
  'quintuplets', 'concussion', 'percussion', 'discussion', 'permission',
  'malicious', 'ferocious', 'atrocious', 'luminous', 'numerous',
  'catastrophe', 'apocalypse', 'metropolis', 'anonymous', 'autonomous',
  // near-rhymes with real spells, which is the hardest case of all
  'expelled the arm is', 'win guardian levi', 'lumos maxima please',
  'a video', 'in the studio', 'reduce it', 'the corpus', 'wonder gum',
  'open the sesame seeds', 'hocus focus', 'abra kebab', 'presto pesto',
  'my mum bought a jumbo', 'silence io', 'im a genius', 'the alarm is off',
]
