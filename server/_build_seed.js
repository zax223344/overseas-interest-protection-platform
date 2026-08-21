/* 一次性构建脚本：把已实拉的 AgentKey 详细全文整合为 server/agentkey_data.json 种子文件。
 * 仅运行一次（node server/_build_seed.js）。实战模式：全部为真实抓取数据，零模拟。
 * 2 篇来自已落盘的 Firecrawl 结果文件；5 篇为本次实拉的内联全文。
 */
const fs = require('fs');
const path = require('path');
const agentkey = require('./agentkey');

const TOOL_DIR = 'C:/Users/28737/.workbuddy/projects/c-Users-28737-WorkBuddy-2026-07-15-04-36-01/91289e8a-76b1-4c88-8d50-75dd6d5b4146/tool-results';
const SAVED = [
  path.join(TOOL_DIR, 'mcp-connector-proxy-agentkey_execute_tool-1785432683792-686f4e.txt'), // ORF
  path.join(TOOL_DIR, 'mcp-connector-proxy-agentkey_execute_tool-1785432681397-ce5090.txt')  // CrisisGroup
];

/* 5 篇内联全文（本次 Firecrawl 实拉，raw markdown 直接嵌入模板字符串） */
const INLINE = [
  {
    query: 'China India linked hacking groups Pakistani law enforcement',
    url: 'https://www.reuters.com/world/china/china-india-linked-hacking-groups-targeted-pakistani-law-enforcement-report-says-2026-07-09/',
    title: 'China, India-linked hacking groups targeted Pakistani law enforcement, report says',
    md: `July 9 (Reuters) - Multiple Pakistani law enforcement agencies were targeted in separate hacking campaigns linked to groups associated with China and India, researchers at cybersecurity firm SentinelOne said on Thursday.

The campaigns offer a glimpse into foreign efforts to gather information on Pakistan's security challenges including militant violence, tensions with Afghanistan and the country's economic collaboration with China.

"When multiple cyberespionage actors operate against law enforcement institutions of a single state, the convergence itself is a signal of target value," Aleksandar Milenkoski, a principal threat researcher at SentinelOne, wrote in a blog published on Thursday.

"What draws them is a particular kind of institution: one that holds the government's internal security picture, what it knows about the threats inside its borders, and how it acts against them."

SentinelOne said it found evidence of multiple hacking campaigns and intrusions carried out by Chinese- and Indian-linked hacking groups between February 2024 and April 2026, most notably against the Balochistan police, which serves Pakistan's southwestern province of the same name.

Liu Chang, the spokesperson for the Chinese Embassy in Washington, said in an emailed statement that China "firmly opposes and combats all forms of cyberattacks in accordance with the law, and does not allow any country or individual to engage in such illegal activities within China's territory or by using China's infrastructure."

The Indian Embassy in Washington did not provide an answer to questions about the analysis.

The report said Chinese interest in the agencies could be linked to the safety of Chinese nationals working in Pakistan, who have been targeted in deadly attacks in recent years. Interest from groups linked to India could be related to tensions between the two countries and Pakistan's broader security posture, it said.

According to Milenkoski, the operations targeting the Balochistan police involved network equipment, web servers and several online applications, including the force's Complaint Management System.

The Balochistan police did not respond to a request for comment.

Other targets included the Khyber Pakhtunkhwa police, the Islamabad police and the Punjab Safe Cities Authority (PSCA), an autonomous government agency that operates systems used by the police in major cities in Punjab province.

The Khyber Pakhtunkhwa police said in a statement that security of its systems is "a matter of the highest priority," and that "there is no evidence that any core KP police system, network, or critical application has been successfully compromised."

"It is pertinent to mention that during the heightened Pakistan-India tensions last year, KP Police experienced an increase in attempted cyber activities," the agency said, and that in "one isolated incident, the login credentials of an end user were compromised."

The Islamabad Police, PSCA, and Pakistani Ministry of Interior did not respond to a request for comment.

Reporting by AJ Vicens in Detroit. Additional reporting by Mushtaq Ali in Peshawar; Editing by Sanjeev Miglani`
  },
  {
    query: 'Sri Lanka Chinese national murder cybercrimes',
    url: 'https://www.reuters.com/world/china/sri-lanka-seeks-six-suspects-chinese-nationals-murder-linked-cybercrimes-2026-07-30/',
    title: "Sri Lanka seeks six suspects in Chinese national's murder linked to cybercrimes",
    md: `COLOMBO, July 30 - Sri Lankan police are searching for six people regarding the murder of a Chinese national suspected of links to computer-related scams, an official said on Thursday, in a crackdown on cyberscam centres tied to transnational fraud networks.

Authorities have arrested about 700 foreign nationals this year, Indian, Chinese, Nepalis and Vietnamese among them, or nearly double the 2025 figure, from hotels, rented houses and apartments nationwide, police data showed.

Police believe the Chinese national, whose body was retrieved a week ago from the town of Eheliyagoda, about 60 km from Colombo, was abducted in the island nation's commercial capital.

"Three suspects linked to the murder are believed to be in Sri Lanka and we have imposed a travel ban on them," police spokesman Frederick Wootler told Reuters.

"Three suspects who managed to leave the country are being traced with support from Interpol."

Two Chinese nationals linked to the murder have been arrested and will be presented in court on August 4, he added, while declining to reveal the identity of the victim.

He is suspected to be part of a larger group of Chinese nationals linked to computer-related scams, two police sources told Reuters, speaking on condition of anonymity.

The Chinese foreign ministry and the Chinese embassy in Colombo did not immediately respond to requests for comment.

The nationwide raids turned up hundreds of mobile telephones, laptops and desktop computers, leading authorities to suspect the foreign nationals had ties to cybercrime networks, they said.

Most of those arrested appeared in court before being deported for overstaying their visas or for working on tourist visas.

Reporting by Uditha Jayasinghe; Editing by Clarence Fernandez`
  },
  {
    query: 'Central Asia looking beyond Iran Afghanistan Pakistan China corridor',
    url: 'https://www.hudson.org/foreign-policy/central-asia-increasingly-looking-beyond-iran-ken-moriyasu',
    title: 'Central Asia Is Increasingly Looking Beyond Iran',
    md: `WASHINGTON -- The recent military escalation between the US and Iran may have subsided for now, but the geopolitical consequences are only beginning to unfold.

As uncertainty hangs over the Strait of Hormuz and regional security, governments across Central Asia are quietly rethinking decades of strategic assumptions about trade, connectivity, and access to global markets.

Ken Moriyasu, a senior fellow at the Hudson Institute focusing on Eurasian affairs, has just returned from Central Asia, where he says one message stood out above all others: countries that once viewed Iran as their natural gateway to the sea are increasingly looking elsewhere.

Earlier this year, after the conflict in February, there were discussions at think tanks around March where Central Asian ambassadors spoke about the possibilities if stability returned to Iran.

If Iran moved toward a pro-business administration, they argued, it would provide the shortest route to warm-water ports for Central Asian countries. There was considerable optimism about what could happen if Iran became stable.

But on this trip, it became very clear to me that Central Asian countries are moving away from that option. They are talking much more about Pakistan and Afghanistan -- using Afghanistan as a transit route to Pakistan.

Even though Afghanistan and Pakistan have their own tensions, they believe resolving those issues is more realistic than waiting for regime change in Iran or for a level of stability that would convince Israel to stop attacking Iran. For them, that now appears to be a very distant possibility.

So, they are looking first at Afghanistan, and if that does not work, then at the China-Pakistan Economic Corridor (CPEC). On paper, CPEC is a fantastic idea. In reality, it has not progressed as much as expected. But even so, Central Asian countries believe a China-Pakistan connection is still more achievable than waiting for circumstances inside Iran to improve.

Pakistan is unique because of its geography. It is both a continental country and a maritime country.

That is very different from India. India is effectively separated from Eurasia by the Himalayas and by Pakistan. It does not really have direct access to Central Asia.

Pakistan is different. It has direct access to Central Asia while also possessing major ports at Karachi and Gwadar that connect to the sea.

Field Marshal Asim Munir (Pakistan's powerful army chief) also has a good relationship with US President Donald Trump. President Trump has recognized that and has clearly decided to lean on Pakistan -- not only for mediation involving Iran, but also because he sees Pakistan as a crucial partner in the broader strategic competition across Eurasia involving China and Russia.

What's interesting is how Pakistan is playing this. Pakistan is engaging more with the United States, but that does not mean it is shifting away from China. It is very important for Americans to understand that by engaging more closely with Washington, Pakistan is actually encouraging China to become even more committed to the China-Pakistan Economic Corridor.

Pakistan is using both sides, and it is working.

A good example is Kazakhstan. Its main oil export pipeline to the Black Sea has effectively been disrupted because of drone attacks, most likely linked to Ukraine's campaign against Russian infrastructure. Around 80 percent of Kazakhstan's oil exports normally move through the Black Sea.

Kazakhstan has two alternatives. One is the Middle Corridor through the Caspian Sea to Azerbaijan. The other is the existing pipeline to China.

Although Kazakhstan would prefer the Middle Corridor, oil must first be transported by tanker across the Caspian Sea to Baku, which limits capacity.

The quickest solution is simply to send more oil to China, and I think that is what will happen.

So, despite Central Asia's concerns about becoming overly dependent on China, that dependence is increasing unless countries such as the United States and Japan invest in Caspian infrastructure that would expand oil shipments between Kazakhstan and Azerbaijan.

From Tehran's perspective, could losing Central Asia become Iran's biggest strategic setback since sanctions were imposed?

Yes. Iran is desperate not to lose this war, but through its own actions it is losing Central Asia. At the same time, it is not only Iran that is pushing Central Asia away. US policy is also contributing.

For example, there have been attacks around Chabahar, the southern Iranian port where India has invested to create an alternative to Gwadar. Those developments make it much harder for an Iran-based trade corridor to compete with the China-Pakistan Economic Corridor.

So, this is partly Iran's responsibility, but it is also a consequence of US policy. Together, they are making the Iran route far less relevant.`
  },
  {
    query: "China's widening involvement South Asia Gulf states Pakistan Afghanistan",
    url: 'https://mei.edu/events/expanding-neighborhood-chinas-widening-and-deepening-involvement-south-asia-and-gulf-states/',
    title: "Expanding the neighborhood: China's widening and deepening involvement in South Asia and the Gulf states",
    md: `Chinese investments, trade relations, diplomatic overtures, and geopolitical penetration of the Gulf and South Asia are broadly altering the economic and political landscapes of local countries. Notable developments like the Chinese-brokered Saudi Arabia-Iran agreement signed in March 2023, the roughly $300 billion economic and security pact China reached with Iran in 2021, and ongoing work on the $65 billion China-Pakistan Economic Corridor (CPEC) have all reshaped strategic thinking across the region.

MEI cordially invites you to an expert panel that will examine the growing multifaceted impact of Beijing's outreach to the wider Middle East -- namely the countries of the Gulf and South Asia. In what ways did Pakistan's close relations and economic dependency on China influence its reaction to the growing Chinese involvement with Saudi Arabia and Iran? What has a more regionally engaged China meant for Afghanistan's Taliban government? And how has India, with its expanding economic links to Arab countries and Iran as well as long-running defense ties with Russia, reacted to increased Chinese involvement in all those key partners?

Speakers:
- Yun Sun, Senior Fellow and Co-Director, China, East Asia, Stimson Center
- Daniel Markey, Senior Advisor, South Asia Programs, USIP
- Khaled Almaeena, Fmr. Editor-in-Chief, Arab News; Saudi Gazette
- Syed Mohammad Ali, Non-Resident Scholar, Middle East Institute
- Gerald M. Feierstein (moderator), Distinguished Senior Fellow on U.S. Diplomacy; Director, Arabian Peninsula Program, Middle East Institute

Key themes: China's geopolitical penetration of South Asia and the Gulf; the Saudi-Iran detente brokered by Beijing; the $65 billion CPEC and its reshaping of Pakistan's strategic calculus; China's engagement with the Taliban-led government in Afghanistan; India's response to deepening Chinese involvement across its key regional partners; implications for U.S. strategic and security interests.`
  },
  {
    query: 'Afghanistan Pakistan war border strikes TTP Taliban 2026',
    url: 'https://www.impriindia.com/insights/policy-update/a-distracted-pakistan-strategic-opportunity-in-the-afghanistan-pakistan-war/',
    title: 'A Distracted Pakistan: Strategic Opportunity In The Afghanistan-Pakistan War',
    md: `Background

Tensions between Pakistan and the Taliban-led government of Afghanistan, simmering since the Taliban's return to power in August 2021, escalated into open warfare in late February 2026. Following weeks of militant attacks inside Pakistan, the Pakistan Air Force struck alleged Tehreek-e-Taliban Pakistan (TTP) and Islamic State-Khorasan camps in Afghanistan's Nangarhar, Paktika and Khost provinces on 21 February, prompting Taliban retaliatory attacks on Pakistani border posts on 26 February. Pakistan's Defence Minister, Khawaja Asif, declared an "open war" and launched Operation Ghazab lil-Haq, a large-scale campaign of air and ground strikes across eastern Afghanistan.

An earlier round of hostilities in October 2025 had produced a Qatar- and Turkey-mediated ceasefire that proved short-lived, with follow-up talks in Doha and Istanbul collapsing before the February 2026 escalation. A subsequent Eid al-Fitr truce in March 2026, and Chinese-mediated talks in Urumqi in April 2026, each produced only temporary lulls, with tensions resurfacing by June 2026 amid renewed Pakistani air and drone strikes and Afghan retaliatory action in Balochistan and Khyber Pakhtunkhwa. Pakistani strikes in late June 2026 reportedly killed 36 Afghan civilians, drawing condemnation from Kabul and a formal statement from India's Ministry of External Affairs.

United Nations human rights experts have characterised Pakistan's cross-border strikes as a violation of the prohibition on the use of force under the UN Charter, while noting that Pakistan has not established that the Taliban directed or controlled TTP attacks on its territory. The conflict has thus evolved from periodic border skirmishes into a sustained, multi-front crisis that has consumed significant Pakistani military, diplomatic and economic bandwidth through mid-2026.

Functioning

The Af-Pak war functions as a genuine two-front strategic dilemma for Pakistan's security establishment. Pakistani forces have simultaneously had to conduct sustained air operations across the western border, defend against Taliban and TTP retaliatory strikes and drone incursions into Balochistan and Khyber Pakhtunkhwa, and respond to a wave of domestic terrorist attacks, including a suicide bombing at a Shia mosque in Islamabad and an attack on a security post in Bajaur. Pakistan has pursued a strategy of establishing forward "buffer zones" inside Afghan territory along the Durand Line, seeking to hold seized pockets as leverage in future negotiations.

Diplomatically, Pakistan has been drawn into successive rounds of externally mediated negotiations, in Doha, Istanbul and Urumqi, each consuming senior political and military attention without producing a durable settlement. Economically, the near-total closure of the border has halted bilateral trade and disrupted the Afghanistan-Pakistan Transit Trade Agreement framework, compounding pre-existing economic strain in both countries. Collectively, these military, diplomatic and economic burdens constitute a significant distraction, diverting Pakistani strategic attention and resources away from its eastern frontier with India at a time of already heightened India-Pakistan tensions following their brief conflict in 2025.

Impact

Pakistan's preoccupation with its western front has opened a clear strategic window for India, even though New Delhi continues to frame its engagement primarily in terms of development and humanitarian support rather than explicit geopolitics. Analysts observe that Pakistani airstrikes inside Afghan territory have inadvertently nudged Kabul closer to India, forged around a shared concern over Islamabad's aggressive posture.

Evidence of Growing Indian Influence in Kabul: Afghan ministers, including the Foreign, Health, Commerce, and Agriculture Ministers, have undertaken official visits to New Delhi. During his 2026 visit, Afghan Agriculture Minister Mawlawi Ataullah Omari publicly emphasised shared civilisational ties, while Kabul actively pitched for easier business access, visa relaxations, and long-term Indian infrastructure investments in mining and pharmaceuticals. In the FY 2026-27 Union Budget, India increased its direct development assistance to Afghanistan by 27% (to Rs 150 crore). In exchange for stepped-up health and agricultural aid, Kabul provided assurances that Afghan territory will not be used by hostile groups against India.

Evidence of Pakistan's Waning Leverage: Afghanistan-Pakistan bilateral transit trade plummeted from nearly $5 billion in FY21 to just $367 million in FY26. Kabul has increasingly replaced Pakistani goods and pharmaceuticals with imports from India and Iran, and activated the Air Freight Corridor (Kabul-Delhi and Kabul-Amritsar) and expanded utilisation of Iran's Chabahar Port, paired with the Zaranj-Delaram Highway, thereby bypassing Pakistani transit entirely.

China's Competing Mediation Role: Beijing's hosting of the Urumqi talks and its role as the sole penholder on Afghanistan at the UN Security Council give China parallel, and potentially competing, influence over any eventual Afghanistan-Pakistan settlement.

Way Forward

India's approach should continue to prioritise humanitarian and developmental engagement with Afghanistan, capacity-building, medical and food aid, and connectivity investment via Chabahar, over any overt strategic messaging that could be construed as exploiting Pakistan-Afghanistan hostilities, thereby preserving deniability while still gaining goodwill in Kabul. Continued, calibrated condemnation of civilian harm on both sides of the Durand Line, consistent with India's stated commitment to Afghan sovereignty and territorial integrity, allows New Delhi to occupy a principled position without being drawn into direct entanglement in the conflict.`
  }
];

function fromSaved(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const d = j && j.data && j.data.data;
    if (!d) return null;
    const meta = d.metadata || {};
    return {
      query: '',
      url: meta.url || meta.ogUrl || d.url || '',
      title: meta.title || meta.ogTitle || d.title || '',
      md: d.markdown || ''
    };
  } catch (e) { console.warn('解析失败', file, e.message); return null; }
}

const items = [];
SAVED.forEach(f => {
  const r = fromSaved(f);
  if (r && r.md && r.md.trim()) {
    items.push(agentkey.makeItem(r.query, { title: r.title, url: r.url, source: '' }, r.md, true, 'firecrawl'));
  }
});
INLINE.forEach(a => {
  if (a.md && a.md.trim()) {
    items.push(agentkey.makeItem(a.query, { title: a.title, url: a.url, source: '' }, a.md, true, 'firecrawl'));
  }
});

const out = items.map((it, i) => Object.assign({}, it, {
  id: 'ak_' + Date.now() + '_' + i,
  seed: true
}));

const outFile = path.join(__dirname, 'agentkey_data.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log('已写入 ' + out.length + ' 条详细情报 → ' + outFile);
console.log(out.map((o, i) => (i + 1) + '. [' + o.category + '|' + o.country + '] ' + o.title.slice(0, 60)).join('\n'));
