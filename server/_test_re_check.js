const gm = require('./globalmedia');
console.log('gm._CHINA_RELATED_RE?', typeof gm._CHINA_RELATED_RE);
console.log('gm._CHINA_NEGATIVE_KW_RE?', typeof gm._CHINA_NEGATIVE_KW_RE);
console.log('gm.chinaNegativeGate?', typeof gm.chinaNegativeGate);

const txt = 'Iran says Pakistan-Saudi-Turkiye defence pact not a threat Speaking at a media briefing, Baghaei said the United States was responsible for insecurity in the Middle East.';

// Try the regex directly from globalmedia if exposed
if (gm._CHINA_RELATED_RE) {
  console.log('gm._CHINA_RELATED_RE.test:', gm._CHINA_RELATED_RE.test(txt));
  console.log('gm._CHINA_RELATED_RE source:', gm._CHINA_RELATED_RE.source);
}
