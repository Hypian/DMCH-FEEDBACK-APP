// ─── Kinyarwanda-aware lexicon for the keyword safety net ────────────────────
// All entries are lowercase, without diacritics, and without apostrophes.
//
// Entry types (see compileEntry in sentiment-analyzer.mjs):
//   'stem'      Kinyarwanda is agglutinative, so a single rw word is a STEM: a token
//               matches when it contains the stem (up to 9 extra prefix/suffix letters).
//               e.g. "itayeho" matches "banyitayeho", "wanyitayeho", "ntibamwitayeho".
//   '=word'     The token must match exactly. Used for short words that would otherwise
//               hide inside unrelated words (e.g. "bibi" = bad, but "bibiri" = two).
//   'a b c'     A multi-word phrase; tokens must match exactly, in order.
//   { re, label }  A RegExp tested against the clause written as " tok1 tok2 tok3 ".
//
// NOTE: A native Kinyarwanda speaker (e.g. DMCH patient-relations staff) should review
// and keep extending this list. Every miss found in production is a one-line addition.

export const RW_RULES = {
  urgent: [
    // Emergencies, critical illness, death
    'ihutirwa', 'ndembe', 'pfuye', 'urupfu', 'impanuka', 'igicuri', '=upfa', '=apfa',
    { re: /\s(?:ku|gu)?[a-z]{0,2}va(?:ga|ye|nga)?\samaraso\s/, label: 'kuva amaraso' },
    { re: /\samaraso\s(?:menshi|aratemba)\s/, label: 'amaraso menshi' },
    { re: /\s(?:gu|ya|na|ba|wa|ra|ma)?ta(?:ye|bye|ga)?\subwenge\s/, label: 'guta ubwenge' },
    { re: /nanirwa[a-z]*(?:\s[a-z]+)?\sguhumeka/, label: 'kunanirwa guhumeka' },
    { re: /\s[a-z]*bura\sumwuka\s/, label: 'kubura umwuka' },
    { re: /ububabare\s(?:bukabije|bwinshi|bukomeye)/, label: 'ububabare bukabije' },
    { re: /uburwayi\s(?:bukabije|bukomeye)/, label: 'uburwayi bukabije' },
    { re: /babara[a-z]*\s(?:cyane|bikabije|bukabije)/, label: 'kubabara cyane' },
    // Negligence and refusal of care
    'burangare', 'rangaye', 'rangara', 'kwangirwa kuvurwa',
    {
      re: /(?:banze|yanze|banga|nanze|bangiye|yangiye|banyangiye)[a-z]*(?:\s[a-z]+){0,3}\s(?:kuvura|kunvura|kumvura|kuvurwa|kunsuzuma|kunyakira|kunyitaho)/,
      label: 'kwanga kuvura'
    },
    // Abuse, violence, harassment, discrimination
    'hohoter', 'toteza', 'totezwa', 'hotora', 'ivangura', 'tutse', 'tukwa', 'gutuka',
    'kubitw', 'kubise', 'kubitse',
    // Fraud, bribery, theft, overcharging, refunds, legal action
    'ruswa', 'akarengane', 'kwiba', 'yibye', 'bibye',
    { re: /subiz[a-z]*\samafaranga/, label: 'gusubizwa amafaranga' },
    {
      re: /(?:shyuje|shyuzwa|shyuza|shyuzwe)[a-z]*(?:\s[a-z]+){0,3}\s(?:menshi|ikirenga|arenze|nyinshi)/,
      label: 'kwishyuzwa amafaranga menshi'
    },
    'munyamategeko', 'urukiko', 'kurega', 'barega', 'zarega', 'ikirego'
  ],
  negative: [
    // "bad" in every noun-class form (exact tokens only: "bibiri"=two, "kibiri"=second)
    'nabi', '=bibi', '=kibi', '=mubi', '=bubi', '=ribi', '=mbi', '=bibabaje',
    // Delays, long waits, crowding
    'tinda', 'tinze', 'tegereje', 'tegereza', 'igihe kirekire', 'umurongo muremure', 'bucucike',
    // Dirt, hygiene, facilities
    'umwanda', 'anduye', 'isuku nke', 'nta suku', 'nta mazi',
    // Pain, distress, anger
    'babara', 'babaza', 'babaje', 'bubabare', 'rakara', 'rakaye', 'mujinya', 'rambirwa', 'rambiwe', 'rambiye',
    // Disrespect and neglect (milder than abuse)
    'suzugu', 'irengagiz', 'tererana', 'tereranw', 'tereranye', 'kutitabwaho', 'batitaye',
    'beshye', 'kubeshya',
    // Dissatisfaction, cost, problems
    'tishimiye', 'sinishimiye', 'ntibishimishije', 'henze', 'henda',
    'bibazo', 'kibazo', 'akavuyo', 'amafuti', 'makosa', 'ingorane', 'imbogamizi', 'bitoroshye',
    // "They did nothing" complaints, kept as phrases because bare "ntacyo" is often "no problem"
    'ntacyo bakoze', 'nta cyo bakoze', 'ntacyo banfashije', 'ntacyo bamfashije', 'nta kintu bakoze',
    'nta muganga'
  ],
  positive: [
    // "good / well" in every noun-class form
    'neza', 'byiza', 'nziza', 'cyiza', 'mwiza', 'beza', 'bwiza',
    // Thanks and gratitude
    'murakoze', 'urakoze', 'mwarakoze', 'turakoze', 'shimira', 'shimiye', 'shimishije', 'shimye',
    'gushima', 'ishimwe', 'nyuzwe',
    // Care, warmth, professionalism
    'urugwiro', 'itayeho', 'itabwaho', 'bumuntu', 'nyamwuga', 'buhanga', 'bwitange',
    'fasha', 'fashije', 'umugisha', 'mukomereze', 'mukomeze',
    // Cleanliness and speed
    'isuku', 'vuba', 'byihuse', 'bihuse'
  ]
};

// Whole-token language markers. "weak" markers are short/ambiguous and count for half.
export const LANG_MARKERS = {
  rw: {
    strong: [
      'kandi', 'cyane', 'nta', 'ntabwo', 'ariko', 'kuko', 'abaganga', 'muganga', 'umuganga',
      'serivisi', 'bakoze', 'byari', 'byose', 'abarwayi', 'umurwayi', 'ibitaro', 'bitaro',
      'ndashimira', 'murakoze', 'neza', 'nabi', 'yari', 'bari', 'njye', 'jye', 'twe', 'mwe',
      'ngo', 'uko', 'iyo', 'aho', 'cyangwa', 'kubera', 'abakozi', 'ubuvuzi', 'kwivuza',
      'nahawe', 'naje', 'nagiye', 'mukomereze', 'amafaranga', 'umwanya', 'igihe', 'nyuma',
      'mbere', 'rwose', 'ndetse', 'harimo', 'hari', 'bose', 'imana', 'mbi'
    ],
    weak: ['ni', 'mu', 'ku', 'na']
  },
  en: {
    strong: [
      'the', 'and', 'was', 'were', 'is', 'are', 'my', 'very', 'not', 'with', 'for', 'this',
      'that', 'they', 'had', 'have', 'but', 'when', 'after', 'we', 'i', 'it', 'to', 'of', 'in'
    ],
    weak: []
  },
  fr: {
    strong: [
      'le', 'la', 'les', 'et', 'est', 'etait', 'tres', 'pas', 'pour', 'avec', 'je', 'mon',
      'ma', 'des', 'une', 'un', 'du', 'au', 'que', 'qui', 'dans', 'sur', 'nous', 'ils', 'elle',
      'ai', 'ete', 'moi', 'personne'
    ],
    weak: ['de']
  }
};

// Tokens that negate sentiment words in the next three tokens of the same clause.
export const NEGATORS = {
  en: new Set(['not', 'no', 'never', 'nothing', 'without', 'cannot', 'hardly', 't', 'didn', 'don', 'wasn', 'weren', 'isn', 'aren', 'couldn', 'wouldn', 'won']),
  fr: new Set(['pas', 'jamais', 'aucun', 'aucune', 'sans', 'non', 'rien']),
  rw: new Set(['nta', 'ntabwo', 'ntaho', 'ntawe', 'ntawundi', 'ntibyari', 'si'])
};

// A Kinyarwanda verb that itself starts with a negative prefix is negated by definition:
// ntibishimishije (not pleasing), sinishimiye (I am not happy), ntibanyitayeho (they didn't care for me).
export const RW_NEGATIVE_PREFIX = /^(?:nti[a-z]+|sin[aeiou][a-z]+)$/;

// Words that begin a new contrast clause ("good doctor BUT long wait").
export const CLAUSE_BREAKERS = new Set([
  'ariko', 'ahubwo', 'nubwo', 'but', 'however', 'although', 'mais', 'cependant', 'pourtant'
]);
