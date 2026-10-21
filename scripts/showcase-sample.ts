/**
 * "The Quiet Lamp of Harrowmere": an original showcase project for the workbench (English source, Korean target).
 * A small harbour-town missing-person mystery in four chapters, written from scratch for this repository.
 * The file carries only what a game extractor would know: groups, lines, speakers and the dialogue graph.
 * Characters, relationships, events, terms and speech rules are left empty on purpose, so the app's own
 * workflows have something to extract.
 *
 * Regenerate: pnpm samples:showcase   (= pnpm tsx scripts/showcase-sample.ts → samples/showcase.loca.json)
 *
 * Devices it exercises (see the scene titles): changing listeners in group scenes, inner monologue, broadcasts,
 * senior↔junior / elder↔young / child↔adult / shopkeeper↔customer / stranger registers, a relationship that
 * thaws, a late ally→enemy reveal, nameless extras, aliases, recurring invented terms, cause→effect events,
 * choice branches that split and merge, an interrogation, placeholders, rich-text tags, line breaks, one long
 * scene, documents and UI strings.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importFileSchema, type ImportFileInput } from '../packages/shared/src/index.ts';

type Line = readonly [speaker: string, text: string];
type Option = { label?: string; pick: Line; then?: Entry[] };
type Choice = { choice: Option[] };
type Entry = Line | Choice;
type Scene = { key: string; title: string; section: string; description?: string; entries: Entry[] };
type Doc = { key: string; title: string; section: string; lines: string[] };

const who = (speaker: string) => (text: string): Line => [speaker, text];
const REEVE = who('REEVE');
const HOLLIS = who('HOLLIS');
const EDDA = who('EDDA');
const PIPPA = who('PIPPA');
const OSWIN = who('OSWIN');
const SORREL = who('SORREL');
const MORROW = who('MORROW');
const CORIN = who('CORIN');
const HETTY = who('HETTY');
const TOBY = who('TOBY');
const CRIER = who('TOWN CRIER');
const RADIO = who('GULL LAMP RADIO');
const CLERK = who('FERRY CLERK');
const FISH = who('FISHMONGER');
const P1 = who('PASSERBY 1');
const P2 = who('PASSERBY 2');
const P3 = who('PASSERBY 3');
const G1 = who('GUARD 1');
const G2 = who('GUARD 2');
const DOCK = who('DOCKHAND');
const CROWD = who('CROWD');
const SAY = who(''); // a line with no speaker (stage direction shown in the text box)

const PROJECT_NAME = 'The Quiet Lamp of Harrowmere — 쇼케이스 샘플';

const CH1 = 'Chapter 1 — The Last Crossing';
const CH2 = 'Chapter 2 — The Brindle Gale';
const CH3 = 'Chapter 3 — The Mooring Ledger';
const CH4 = 'Chapter 4 — Skerrin Rock';

// ───────────────────────── Chapter 1 ─────────────────────────
const ch1: Scene[] = [
  {
    key: 'c1.ferry',
    title: 'Greywater Ferry, last crossing',
    section: CH1,
    entries: [
      CLERK(`Last call for Harrowmere, folks! Have your tickets out.`),
      REEVE(`Excuse me. I have a Tidewatch voucher, not a ticket. Is that all right?`),
      CLERK(`Tidewatch, is it? Hold on, I'll find the stamp for that.`),
      CLERK(`There. Mind the plank, it bounces.`),
      REEVE(`Thank you. Is the sea always this grey?`),
      CLERK(`Grey? This is a cheerful day. Wait for the gale season.`),
      P1(`Another new face. That's the third this month.`),
      P2(`Shh. She's Tidewatch. Look at the coat.`),
      SAY(`The ferry horn sounds twice, long and low.`),
      REEVE(`Constable {player} Reeve, first posting. Deep breath, and do not trip on the plank.`),
      CLERK(`Harrowmere in ten minutes! Hold your hats, and hold your stomachs!`),
    ],
  },
  {
    key: 'c1.quay',
    title: 'Dunnock Quay: the inspector',
    section: CH1,
    entries: [
      HOLLIS(`Constable Reeve. You are eleven minutes behind the timetable.`),
      REEVE(`The ferry was held for a cargo check, Inspector. I apologise.`),
      HOLLIS(`Do not apologise to me. Apologise to the tide. It waits for nobody.`),
      HOLLIS(`Dorian Hollis, Inspector of the Harrowmere Tidewatch. You will use the title.`),
      REEVE(`Yes, Inspector. Constable {player} Reeve, reporting for duty.`),
      HOLLIS(`Your file says you finished first in your class. This is not a classroom.`),
      REEVE(`No, sir. I understand.`),
      HOLLIS(`Inspector. Not "sir." Sir is for schoolmasters.`),
      FISH(`Oi, Old Gull! Is that the new one? She looks about twelve!`),
      HOLLIS(`Mind your own crates.`),
      HOLLIS(`Ignore him. The fishmongers of Dunnock Quay say whatever comes into their heads, and it is usually about me.`),
      REEVE(`He called you a gull, Inspector?`),
      HOLLIS(`A nickname. I did not choose it and I will not discuss it.`),
      HOLLIS(`Now. Corin Ashdale, twenty-four, clerk of the Net-Menders' Union. Last seen four nights ago.`),
      HOLLIS(`His boat, the <i>Pale Heron</i>, was found drifting off Skerrin Rock yesterday. Empty.`),
      REEVE(`Then he is presumed drowned?`),
      HOLLIS(`"Presumed" is a word for people who have stopped looking. We have not.`),
      HOLLIS(`Walk with me. Say nothing to the press, and nothing to the family until I say so.`),
      REEVE(`Understood, Inspector.`),
      REEVE(`Four nights. And the boat came home without him.`),
    ],
  },
  {
    key: 'c1.office',
    title: 'Tidewatch office: tea and the Mooring Ledger',
    section: CH1,
    entries: [
      EDDA(`There you are! Come in, come in, mind the draught. The kettle's on.`),
      HOLLIS(`Miss Fenwick, this is Constable Reeve. Constable, Miss Fenwick keeps our records.`),
      EDDA(`Keeps them, scolds them, and feeds them. Welcome to Harrowmere, dear.`),
      REEVE(`Thank you, Miss Fenwick. It is good to meet you.`),
      EDDA(`Edda, please. Nobody's called me Miss Fenwick since the old harbourmaster retired.`),
      EDDA(`The young ones call me Mother Hen, because I fuss. You may as well, if you must.`),
      HOLLIS(`The Mooring Ledger, Edda. Reeve needs to see last month's entries.`),
      EDDA(`Of course. Grey cabinet, third drawer down. The key sticks, so give it a jiggle.`),
      REEVE(`That is a great many berths. Did Mr. Ashdale work on these pages?`),
      EDDA(`Corin did the sums for the Net-Menders' Union and I checked them. Sweet boy. Careful with numbers, careless with his supper.`),
      EDDA(`He took it hard, you know, about the <i>Pale Heron</i>. Her paint was his father's.`),
      REEVE(`Took what hard?`),
      EDDA(`Oh, the debts, dear. The boat was mortgaged to the mast. Most fishing families are.`),
      {
        choice: [
          {
            label: 'Ask about the debts',
            pick: REEVE(`Debts to whom, exactly?`),
            then: [
              EDDA(`The Union fund, mostly. He swore he'd pay it back in full.`),
              HOLLIS(`Noted. Reeve, we will look at the fund accounts tomorrow.`),
            ],
          },
          {
            label: 'Ask to see the boat',
            pick: REEVE(`I would like to see the boat myself, Inspector.`),
            then: [
              HOLLIS(`Tomorrow. The tide is wrong today.`),
              EDDA(`Wise. Skerrin Rock bites at the wrong tide.`),
            ],
          },
        ],
      },
      HOLLIS(`Edda believes he may have taken the boat out in despair.`),
      EDDA(`I don't believe it, Dorian. I only fear it. There's a difference.`),
      HOLLIS(`Yes. Quite.`),
      REEVE(`She calls him Dorian. Nobody else has dared.`),
      EDDA(`Tea, everyone! Constable, sugar? You look as if you could use two.`),
      REEVE(`One, please. Thank you.`),
      HOLLIS(`Put the cups down. Work first.`),
      EDDA(`Work after tea, Dorian. A hungry constable finds nothing.`),
      HOLLIS(`Reeve. Take the {item} from the evidence shelf. It came off the <i>Pale Heron</i>.`),
      REEVE(`A scarf, Inspector. Wet wool, a child's knitting pattern.`),
      EDDA(`That'd be Pippa's. Corin's little sister knitted it for him at Midwinter. Poor lamb.`),
      EDDA(`She's staying with Oswin Tarn, down by the Brine Steps. Be gentle with her.`),
      HOLLIS(`We shall see her this afternoon. Edda, keep the ledger safe.`),
      EDDA(`Locked and watched, Dorian. Nobody touches it but me.`),
    ],
  },
  {
    key: 'c1.notebook',
    title: 'Notebook, day one',
    section: CH1,
    description: 'The player writing in the notebook: nobody is spoken to.',
    entries: [
      REEVE(`Day one. Harrowmere smells of tar and boiled cabbage.`),
      REEVE(`Hollis speaks as if every word is billed by the syllable.`),
      REEVE(`Facts: the boat came back empty, the mooring ring is a mile from where it should be, and the Union's accounts are in the grey cabinet.`),
      REEVE(`Miss Fenwick is kind. Write that down, too. It might be the only kind thing today.`),
      REEVE(`Questions for tomorrow:\n1. Who tied the <i>Pale Heron</i>?\n2. Why was Corin whistling?`),
    ],
  },
  {
    key: 'c1.market',
    title: 'Lowtide Market: fish, rope and one notebook',
    section: CH1,
    entries: [
      FISH(`Mackerel, still twitching! Two for a copper, three if you smile!`),
      P1(`Two for a copper? Yesterday it was four.`),
      FISH(`Yesterday there wasn't a gale coming. Take it or leave it, love.`),
      REEVE(`Excuse me. Have you seen Corin Ashdale in the last few days?`),
      FISH(`The Union lad? Not since Tuesday. Bought a pound of herring, paid in coin, whistled like a kettle.`),
      FISH(`Whistling. Doesn't sound like a boy about to throw himself in the water, does it?`),
      P2(`Don't go asking that. Folk say the <i>Pale Heron</i> is cursed.`),
      REEVE(`Cursed how?`),
      P2(`Don't ask me. Ask old Tarn. He knows every ghost on the quay.`),
      P3(`Make way! Cart coming through, make way!`),
      HOLLIS(`Reeve. The chandler next. We need the rope receipts.`),
      SORREL(`Morning, Inspector. The usual, or is this business?`),
      HOLLIS(`Both. Two fathoms of grey line, and do not charge me the tourist price.`),
      SORREL(`Tourist price! For you it's the honest price, which is rare enough around here.`),
      SORREL(`And who's this? New blood? Welcome, miss. Anything you need, I've got it or I'll find it.`),
      REEVE(`Thank you. I need a notebook with a waterproof cover, please.`),
      SORREL(`Good choice. That one's two silver, but for a Tidewatch lass, one and a half.`),
      REEVE(`That is very kind of you. I will take it.`),
      SORREL(`Anything else for you, Constable? Bootlaces? Lamp oil? A good knot-book?`),
      REEVE(`That is all, thank you.`),
      SORREL(`Mind how you go. And if you see the Ashdale girl, tell her the aniseed sweets are on me.`),
      DOCK(`All hands to the quay! The cargo's in!`),
    ],
  },
  {
    key: 'c1.steps',
    title: 'The Brine Steps: Pippa and old Tarn',
    section: CH1,
    entries: [
      PIPPA(`Are you the lady who's going to find Cor?`),
      REEVE(`I am going to try. What is your name?`),
      PIPPA(`Pippa Ashdale. I'm nine and three quarters.`),
      PIPPA(`Grander Tarn says never talk to strangers, but you're Tidewatch, so you're only half a stranger.`),
      OSWIN(`Pippa! Come away from the lass. She's working.`),
      PIPPA(`She's not working, she's standing.`),
      OSWIN(`Standing is working, when you wear that coat.`),
      OSWIN(`Tarn's the name. Oswin. Most call me Grander, though I'm nobody's grandfather.`),
      REEVE(`Mr. Tarn, sir, I would like to ask you about the <i>Pale Heron</i>.`),
      OSWIN(`Would you, now? Sit, lass. These steps are hard on old bones.`),
      OSWIN(`That boat never came loose on her own. Corin tied his bowline the Harrowmere way, left over right. I taught him myself.`),
      OSWIN(`The knot on her mooring ring was right over left. A stranger's knot.`),
      REEVE(`A stranger's knot. Are you certain?`),
      OSWIN(`I've been certain of three things in seventy-eight years. Tides, taxes and knots.`),
      {
        choice: [
          {
            label: 'Promise',
            pick: REEVE(`Pippa, I promise I will do everything I can.`),
            then: [PIPPA(`That's not a promise. That's what grown-ups say instead of one.`)],
          },
          {
            label: 'Tell the truth',
            pick: REEVE(`I do not know yet. But I will always tell you the truth.`),
            then: [
              PIPPA(`Cor says the truth is the only thing that floats.`),
              OSWIN(`He's a clever lad. Too clever for his own good, some say.`),
            ],
          },
          {
            label: 'Give the {item}',
            pick: REEVE(`Sorrel left something for you. Here, {item}.`),
            then: [PIPPA(`Aniseed! Yuck! ...Thank you. I'll give it to the gulls.`)],
          },
        ],
      },
      OSWIN(`Pippa, home. Your supper's cooling.`),
      PIPPA(`Bye, lady constable! Don't let Mister Gull scare you!`),
      REEVE(`Mister Gull?`),
      OSWIN(`She means Hollis. The whole quay calls him the Old Gull. He pretends not to hear.`),
    ],
  },
  {
    key: 'c1.crier',
    title: 'Town crier at the Brine Steps',
    section: CH1,
    description: 'A public announcement: nobody in particular is addressed.',
    entries: [
      CRIER(`Hear ye, hear ye, Harrowmere! The Tidewatch seeks word of Corin Ashdale, clerk, last seen at Dunnock Quay!`),
      CRIER(`Anyone with knowledge, speak to the Tidewatch office, and speak soon.`),
      CRIER(`The Greywater Ferry makes her last crossing at dusk. The Brindle Gale is expected by morning!`),
      CRIER(`Secure your nets, your shutters and your children, good people!`),
      P2(`Last crossing. Then we're shut in, with a boy gone missing.`),
      P1(`Hush. You'll frighten the little ones.`),
      CROWD(`Shame on the Tidewatch! Find him!`),
    ],
  },
  {
    key: 'c1.radio',
    title: 'Gull Lamp radio, evening sign-on',
    section: CH1,
    description: 'Broadcast from the Gull Lamp on Skerrin Rock: addressed to every listener.',
    entries: [
      RADIO(`This is the Gull Lamp, Skerrin Rock, signing on for the evening. Visibility poor, wind rising from the north-west.`),
      RADIO(`All vessels are advised to stay in harbour. The Fogbell will ring on the hour until further notice.`),
      RADIO(`Anyone with news of Corin Ashdale, of Dunnock Quay, may leave word with the keeper at first light.`),
      RADIO(`That is all from the Gull Lamp. Keep your lanterns trimmed, Harrowmere.`),
      REEVE(`The Fogbell rings on the hour. Remember that.`),
    ],
  },
];

const ch1Docs: Doc[] = [
  {
    key: 'c1.gazette',
    title: 'Newspaper clipping: Harrowmere Gazette',
    section: CH1,
    lines: [
      `HARROWMERE GAZETTE — Thursday Edition`,
      `<b>PALE HERON FOUND ADRIFT</b>`,
      `The fishing boat <i>Pale Heron</i>, property of the late Ansel Ashdale, was found drifting off Skerrin Rock on Wednesday morning, her sails furled and her cabin dry.`,
      `Her owner's son, Corin Ashdale, 24, clerk of the Net-Menders' Union, has not been seen since Saturday night.\nThe Tidewatch asks anyone with information to come forward.`,
      `Harbour folk are reminded that the Brindle Gale is expected within the week. Ferries may be suspended without notice.`,
      `ALSO: Lowtide Market reopens Friday. Mackerel, two for a copper.`,
    ],
  },
];

// ───────────────────────── Chapter 2 ─────────────────────────
const ch2: Scene[] = [
  {
    key: 'c2.warning',
    title: 'Gull Lamp storm warning',
    section: CH2,
    description: 'Broadcast to the whole harbour.',
    entries: [
      RADIO(`Gull Lamp to all of Harrowmere. The Brindle Gale has turned early. Landfall at dawn.`),
      RADIO(`Greywater Ferry is suspended. Repeat, the ferry is suspended until the wind drops below gale force.`),
      RADIO(`If you hear the Fogbell ring out of turn, do not come looking. Stay where you are.`),
      CRIER(`You heard the lamp, good people! Doors barred, lamps low, and keep to the Union hall if your roof is thin!`),
      P3(`Hall's open? Then I'm bringing the cat.`),
      P1(`Bring the whole street. Hetty won't turn anyone away.`),
    ],
  },
  {
    key: 'c2.quay',
    title: 'Dunnock Quay, before the gale',
    section: CH2,
    entries: [
      HOLLIS(`The tide-glass in the office dropped like a stone overnight. Reeve. Report.`),
      REEVE(`I checked the three mooring rings, Inspector. The knot Mr. Tarn described is on the middle one. Right over left.`),
      HOLLIS(`And the fund accounts?`),
      REEVE(`Miss Fenwick says the Mooring Ledger is in order, but I have not yet compared it with the Union's own books.`),
      HOLLIS(`Then you will do so when the gale has passed. Walk faster, the wind is turning.`),
      G1(`Inspector! Quay's closing. Orders from the harbour board, nobody on the outer pier.`),
      HOLLIS(`I know my own orders, Guard.`),
      G1(`Sorry, sir. And who is she?`),
      REEVE(`Constable Reeve, Tidewatch.`),
      G1(`Then you'd best get her indoors, sir. First gust took a man's hat clean to Skerrin Rock.`),
      DOCK(`Hey! You two! Tie that skiff down or lose her!`),
      HOLLIS(`Reeve. The skiff. Ropes.`),
      REEVE(`Right over left, Inspector, or left over right?`),
      HOLLIS(`...Left over right. The Harrowmere way.`),
      REEVE(`Of course. Done.`),
      HOLLIS(`Hm. Not entirely hopeless, Constable.`),
    ],
  },
  {
    key: 'c2.hall',
    title: 'Net-Menders\' Union hall: the night of the gale',
    section: CH2,
    description: 'The long group scene: the whole cast shelters from the storm; the person being spoken to changes almost every line.',
    entries: [
      SAY(`Rain hammers the shutters. A few dozen people crowd the hall with blankets and lanterns.`),
      HETTY(`Settle, everyone! Blankets on the left, lamps on the right, and nobody lights anything near the nets!`),
      TOBY(`Hetty, there's a hole in the north roof the size of a barrel.`),
      HETTY(`Then put a barrel under it, Toby. We've done it before.`),
      TOBY(`That's your answer? A barrel?`),
      HETTY(`That's my answer, and it's a good one. Go on.`),
      EDDA(`Sit, sit, everyone. I've brought the big pot. There's enough soup for the whole hall.`),
      PIPPA(`Mother Hen! Can I have the end of the loaf?`),
      EDDA(`The end of the loaf, and the butter, and a blanket for your knees. Come here, lamb.`),
      OSWIN(`Eddie girl, you spoil that child.`),
      EDDA(`Somebody has to, Oswin. Eat your soup and stop being clever.`),
      HOLLIS(`Miss Fenwick, if I may. Chair Vale, a word before the soup.`),
      HETTY(`Inspector. Make it quick, I've got ninety people to dry out.`),
      HOLLIS(`Corin Ashdale. When did you last speak with him?`),
      HETTY(`Saturday afternoon. Here, in this room. He asked me for the Union's account books.`),
      REEVE(`Did he say why, Chair Vale?`),
      HETTY(`Call me Hetty, nobody says Chair Vale unless there's a fine coming. He said the numbers didn't match.`),
      REEVE(`Which numbers?`),
      HETTY(`The fund. Berth fees, pension dues. He said six hundred silver were missing, and he wanted to find where it went before he told the members.`),
      TOBY(`Six hundred? That's a year's pension for half of this hall!`),
      HETTY(`Toby, keep your voice down. That is exactly why he wanted to tell us properly.`),
      OSWIN(`Six hundred. Aye, that's a number a man might be quiet about.`),
      HOLLIS(`Mr. Orme. You quarrelled with Ashdale last week.`),
      TOBY(`Who told you that?`),
      HOLLIS(`Half the quay. Answer the question.`),
      TOBY(`We argued about dues, that's all. He's my friend. He was my friend. Is my friend!`),
      PIPPA(`Cor is still your friend, Toby. You said so at the fair.`),
      TOBY(`I know, Pip. I know. Sorry I shouted.`),
      SORREL(`Hmph. Shouting won't find the boy. A good lamp might. Anyone short of oil, I've a barrel in the back.`),
      HETTY(`Sorrel, you're a saint.`),
      SORREL(`I'm a shopkeeper. Saints don't send invoices, Hetty.`),
      {
        choice: [
          {
            label: 'Question Toby',
            pick: REEVE(`Toby, where were you on Saturday night?`),
            then: [
              TOBY(`Mending nets on the far side of the quay. Ask anyone, I was there until midnight.`),
              OSWIN(`He was. I fell asleep on his bench, and he lent me his coat.`),
              REEVE(`Thank you, Mr. Tarn. That is useful.`),
            ],
          },
          {
            label: 'Question Hetty',
            pick: REEVE(`Hetty, who else knew Corin was looking at the accounts?`),
            then: [
              HETTY(`Nobody. I told him not to speak of it until we had more.`),
              EDDA(`I knew a little, dear. He asked me for the old mooring sheets, that's all. I thought he was tidying.`),
              REEVE(`Tidying, Miss Fenwick?`),
              EDDA(`Corin tidied when he was worried. It was his way.`),
            ],
          },
        ],
      },
      HOLLIS(`Noted. Reeve, write it all down.`),
      REEVE(`I already am, Inspector.`),
      HOLLIS(`Good.`),
      SAY(`A gust slams the shutters. The lanterns gutter, then steady.`),
      PIPPA(`Lady constable, is that the sea knocking?`),
      REEVE(`It is only wind, Pippa. Wind knocks, but it cannot come in.`),
      PIPPA(`The sea can come in, though. It came in last year. We had a fish in the pantry.`),
      OSWIN(`Aye, a fine fat bream. She named him Gerald.`),
      PIPPA(`He was a good fish.`),
      P1(`Is it true, what they say? That the Fogbell rang itself on Skerrin Rock last night?`),
      P2(`The keeper swears he never touched it.`),
      HETTY(`Quiet, you two. Don't spook the children.`),
      OSWIN(`It rings when the wind finds the rope. Always has. Don't fret, Hetty.`),
      TOBY(`Wind doesn't ring on the hour, Grander.`),
      OSWIN(`Doesn't it? Wind has done stranger things.`),
      HOLLIS(`Mr. Tarn, you fish those waters. Could a man survive a night on Skerrin Rock?`),
      OSWIN(`In the old fogbell chamber? Dry as a biscuit, up the stairs. If he had food and a candle.`),
      REEVE(`The chamber. Inspector, we should check it when the weather clears.`),
      HOLLIS(`We shall consider it. For now, we eat.`),
      EDDA(`There! Hear that? The sensible man speaks. Bowls, everyone, bowls!`),
      HETTY(`Everybody listen up! Soup first, stories after. Pass your bowls to the front!`),
      CROWD(`Thank you, Mother Hen!`),
      EDDA(`Oh, go on with you.`),
      SORREL(`Constable, a word. Strictly between us.`),
      REEVE(`Of course, Miss Brant.`),
      SORREL(`Last week I sold a length of heavy chain and a padlock. Paid in coin. I don't ask names, it's bad for trade.`),
      REEVE(`Who bought them?`),
      SORREL(`That's the thing. I can't quite see the face. Wind and hood and rain, that evening.`),
      REEVE(`Would you know them again?`),
      SORREL(`Maybe. Maybe not. I'll think on it. Don't you tell the Inspector yet. He frightens a woman into forgetting.`),
      REEVE(`I will say nothing until you are ready.`),
      HOLLIS(`Reeve. What are you whispering about with the chandler?`),
      REEVE(`Lamp oil, Inspector. The price has risen.`),
      HOLLIS(`Hm.`),
      TOBY(`Does anyone else smell smoke?`),
      HETTY(`Toby, if that's your pipe, I'll drown it myself.`),
      TOBY(`It isn't my pipe!`),
      DOCK(`Fire! No, no, sorry, it's the soup! Somebody burned the soup!`),
      EDDA(`I did not burn the soup. I let it develop character.`),
      HETTY(`Ha! Everyone, calm down. It's the soup.`),
      PIPPA(`Can I still have some?`),
      EDDA(`The top of the pot is perfect, lamb. Here.`),
      SAY(`The hall settles. The wind drops to a long, low moan.`),
      REEVE(`Inspector, may I say something?`),
      HOLLIS(`You may.`),
      REEVE(`If Corin found six hundred silver missing, someone else knows he found it.`),
      HOLLIS(`That is a supposition. But it is not a stupid one.`),
      REEVE(`Thank you, Inspector.`),
      HOLLIS(`Do not thank me for the obvious. Go and sit with the child, she is shivering.`),
      DOCK(`Inspector! Constable! The <i>Pale Heron</i> has torn her moorings and capsized against the Brine Steps!`),
      HOLLIS(`Coats. Now.`),
    ],
  },
  {
    key: 'c2.steps',
    title: 'The Brine Steps in the gale',
    section: CH2,
    entries: [
      REEVE(`There! The hull, against the steps. Inspector, the cabin door is open.`),
      HOLLIS(`Careful. The planks are slick. Hold the lantern higher.`),
      OSWIN(`Poor girl. Forty years she carried that family, and now look at her.`),
      REEVE(`Mr. Tarn, you should not be out here. It is not safe.`),
      OSWIN(`Not safe, she says. Lass, I've been out in worse than this at your age and in a leaky bucket.`),
      HOLLIS(`Mr. Tarn. Stand clear of the hull, please.`),
      OSWIN(`I'll stand where I please, Dorian Hollis, and you know why.`),
      HOLLIS(`...As you wish. Reeve, the locker under the bunk.`),
      REEVE(`A hidden locker behind the bunk panel, split open by the waves. A pea-coat, wet through, and a letter in the inside pocket, sealed in oilcloth.`),
      HOLLIS(`Give it here.`),
      REEVE(`It is addressed to Pippa Ashdale, Inspector. Not to us.`),
      HOLLIS(`It may be evidence.`),
      REEVE(`With respect, it is also a child's letter. May I read it first, and decide what the child can bear?`),
      HOLLIS(`...You may. Briefly.`),
      DOCK(`Another gust! Everybody back from the Steps!`),
      REEVE(`Inspector, hold the {item} while I read under the awning.`),
      HOLLIS(`Hold it away from the water, Constable.`),
    ],
  },
  {
    key: 'c2.notebook',
    title: 'Notebook, night of the gale',
    section: CH2,
    entries: [
      REEVE(`Night two. The sea gave back a coat and a letter, and took nothing in return.`),
      REEVE(`Corin wrote: "I've found where the money goes. I'm going to tell someone I trust tonight."`),
      REEVE(`Someone he trusts. So he told someone. Then he vanished.`),
      REEVE(`I should feel clever. I feel cold.`),
      REEVE(`Oswin says a man could survive a night in the fogbell chamber. A night. Not four.`),
      REEVE(`Check the chamber at first light. If the gale lets me.`),
    ],
  },
  {
    key: 'c2.pippa',
    title: 'Pippa and the letter',
    section: CH2,
    entries: [
      REEVE(`Pippa, do you have a moment? I found something that belongs to you.`),
      PIPPA(`Is it Cor's? It is! It's got my name on it! He draws my name with a loop on the P.`),
      REEVE(`He does. May I sit with you while you read it?`),
      PIPPA(`Only if you don't tell Mother Hen I was up late.`),
      EDDA(`Too late, lamb. I've got ears like a bat. Come here, both of you, you'll catch your death.`),
      PIPPA(`Cor says: "Pip, I'll be home soon. Feed Gerald's ghost a crumb." That's our joke!`),
      REEVE(`He sounds like he intended to come back.`),
      EDDA(`Of course he did, dear. Of course. Don't read too much into a letter, now.`),
      PIPPA(`Lady constable? Is Cor in the sea?`),
      REEVE(`I do not think so. I think someone is hiding him, or holding him.`),
      PIPPA(`Then you have to find him before the tide goes out. Cor says the tide takes things.`),
      REEVE(`I will find him, Pippa. I promise.`),
    ],
  },
  {
    key: 'c2.radio',
    title: 'Gull Lamp radio, past midnight',
    section: CH2,
    entries: [
      RADIO(`Gull Lamp, Skerrin Rock, midnight bulletin. Gale at peak. Waves breaking over the causeway.`),
      RADIO(`Note to the harbour: the Fogbell has rung thrice off the hour. The keeper is checking the rope.`),
      MORROW(`Gull Lamp, this is the keeper. The rope is frayed, not cut. It rings with the wind. That is all. Do not cross.`),
      RADIO(`End of bulletin. Keep warm, Harrowmere.`),
      HOLLIS(`The wind. Twice now, the wind. I do not like it.`),
      REEVE(`Nor do I, Inspector.`),
    ],
  },
];

const ch2Docs: Doc[] = [
  {
    key: 'c2.letter',
    title: 'Letter: Corin to Pippa',
    section: CH2,
    lines: [
      `Dear Pip,`,
      `If you're reading this, I'm probably late for supper again. Don't tell Grander Tarn.`,
      `I've found out something that's been bothering me for weeks. Numbers don't lie, but people can make them say the wrong thing.`,
      `I'm going to tell someone I trust tonight. If it goes well, I'll be home by the first bell.\nIf it doesn't...`,
      `...well, feed Gerald's ghost a crumb, and keep the red scarf warm for me.`,
      `Love,\nCor`,
    ],
  },
  {
    key: 'c2.notice',
    title: 'Notice board: Tidewatch storm rules',
    section: CH2,
    lines: [
      `<b>TIDEWATCH NOTICE — GALE SEASON</b>`,
      `1. The outer pier is closed whenever the Gull Lamp flies two red lanterns.`,
      `2. Skiffs must be tied with two knots, left over right, and registered with the Mooring Ledger.`,
      `3. Anyone found on Skerrin Rock without the keeper's leave will be fined.`,
      `By order of the Harrowmere Tidewatch.`,
    ],
  },
];

// ───────────────────────── Chapter 3 ─────────────────────────
const ch3: Scene[] = [
  {
    key: 'c3.gate',
    title: 'Tidewatch gate, morning after the gale',
    section: CH3,
    entries: [
      G1(`Halt! State your... oh. Inspector. Morning, sir.`),
      G2(`Morning, Inspector. Rough night. Roof's off the lamp store.`),
      HOLLIS(`Then fix it. Reeve, with me.`),
      G2(`Is that the new one? She's got a stern face for a rookie.`),
      G1(`Shh. She can hear you.`),
      REEVE(`I can, Guard. Good morning.`),
      G2(`Ah. Sorry, Constable. Mornin'.`),
      G1(`Don't mind him. He's been on the gate since the old harbourmaster's day.`),
      HOLLIS(`Stop gossiping, both of you. Has anyone been in or out of the office since last night?`),
      G1(`Only Miss Fenwick, sir. Came at dawn to light the stove.`),
      G2(`Looked fair worn out. Her shawl was soaked.`),
      HOLLIS(`She works too hard. Open the gate.`),
    ],
  },
  {
    key: 'c3.ledger',
    title: 'The grey cabinet: pages gone from the Mooring Ledger',
    section: CH3,
    entries: [
      EDDA(`Oh, Dorian, dear, I can't tell you. I came in to light the stove and found the cabinet open.`),
      HOLLIS(`Open? I thought only you had the key.`),
      EDDA(`I did. I do! The lock hasn't been forced. Whoever it was, they knew the jiggle.`),
      REEVE(`The jiggle, Miss Fenwick?`),
      EDDA(`The trick of the key, dear. It sticks. Half the quay knows it.`),
      REEVE(`Half the quay has been in this office?`),
      EDDA(`Not half. But you'd be surprised who pops in for a cup of tea.`),
      HOLLIS(`What is missing, exactly?`),
      EDDA(`Eleven pages. All of them from the autumn quarter, the berth fees.`),
      REEVE(`The same quarter Corin was investigating.`),
      EDDA(`Oh. Oh, I hadn't thought of that. How dreadful.`),
      EDDA(`Pardon the state of me. I've been up all night with my old grey shawl and that dreadful stove.`),
      HOLLIS(`Edda. Sit. Reeve, fetch her a chair.`),
      REEVE(`At once, Inspector.`),
      EDDA(`You're kind, both of you. Truly. I'm sorry, I'm quite undone.`),
      HOLLIS(`Who has been asking after the ledger this week?`),
      EDDA(`Well, Toby Orme popped in, twice. Said he needed the Union copies. He seemed rather fretful.`),
      HOLLIS(`Toby was mending nets until midnight on Saturday. Tarn vouches for it.`),
      EDDA(`Did he? Oh, good. Good. I'd hate to think it was him.`),
      REEVE(`Miss Fenwick, did Corin say anything about the ledger before he went missing?`),
      EDDA(`Only that he'd found a mistake. He wouldn't say where. He was the careful sort, you know.`),
      REEVE(`Thank you. I will look at the empty slots in the cabinet, if I may.`),
      EDDA(`Of course, dear. Mind your sleeves, the lacquer's wet.`),
      HOLLIS(`Reeve. The padlock on that drawer. Is it new?`),
      REEVE(`It is, Inspector. The brass is bright. Whoever fitted it did so recently.`),
      HOLLIS(`Then someone wanted that cabinet secure. Or wanted it to look secure.`),
    ],
  },
  {
    key: 'c3.notebook',
    title: 'Notebook, day five',
    section: CH3,
    entries: [
      REEVE(`Day five. Eleven pages gone, and a brand-new padlock on a cabinet that was never locked before.`),
      REEVE(`Sorrel sold a chain and a padlock to a hooded stranger. A coincidence? I do not believe in those, not here.`),
      REEVE(`Suspects: Toby (no alibi problem), Hetty (fund chair), Sorrel (the lock). Everyone else is a friend.`),
      REEVE(`Hollis is wrong to trust no one. And I am wrong to trust everyone.`),
    ],
  },
  {
    key: 'c3.market',
    title: 'Lowtide Market, morning gossip',
    section: CH3,
    entries: [
      FISH(`Herring! Last of the stock before the ferry comes back! Don't dawdle!`),
      P1(`Is it true the Pale Heron was cut loose by hand?`),
      FISH(`I heard it was a ghost. The sea took him, they say, and gave back the boat out of spite.`),
      P2(`A ghost! Honestly. It was somebody with a knife and a grudge.`),
      P3(`Somebody in a grey shawl, I heard. Lurking on the Steps.`),
      FISH(`Grey shawls! Half of Harrowmere owns a grey shawl. My mother owned three.`),
      P1(`And I heard the Old Gull has finally met his match. Look at him following her around.`),
      FISH(`Other way round, love. She's the one with the notebook.`),
      REEVE(`Excuse me, may I ask you something?`),
      FISH(`Course. Mackerel, two for a copper.`),
      REEVE(`Not fish, thank you. Did you see anyone near the Pale Heron on Saturday night?`),
      FISH(`Saturday? Dark as a bucket. I saw a skiff leave the pier around ten. Tidewatch colours, I thought.`),
      REEVE(`Tidewatch colours? Are you sure?`),
      FISH(`Grey hull, brass fittings. Aye. Anyone can paint a boat.`),
    ],
  },
  {
    key: 'c3.interrogation',
    title: 'Sorrel\'s back room: the interrogation',
    section: CH3,
    description: 'An interrogation with branching approaches.',
    entries: [
      SORREL(`Close the door, then. I don't like the draught or the questions.`),
      HOLLIS(`Miss Brant, you sold a length of heavy chain and a padlock last week.`),
      SORREL(`I sell chain every week. It's a chandlery, Inspector.`),
      HOLLIS(`Constable Reeve will take it from here.`),
      REEVE(`Thank you, Inspector. Miss Brant, thank you for seeing us.`),
      SORREL(`Seeing you. Hm. As if I had a choice.`),
      {
        choice: [
          {
            label: 'Press her',
            pick: REEVE(`Miss Brant, a boy is missing and you are holding something back. Who bought the chain?`),
            then: [
              SORREL(`Don't you bark at me in my own back room, girl.`),
              SORREL(`Fine. Fine! A customer, in the rain. That's all I said.`),
              HOLLIS(`That is not all you said on the night of the gale.`),
              SORREL(`I said I couldn't see the face. And that's true!`),
            ],
          },
          {
            label: 'Soften',
            pick: REEVE(`Miss Brant, you were kind to me on my first day. I would like to be kind in return. What worries you?`),
            then: [
              SORREL(`Kind. Hmph. You'll go far, miss, or get yourself killed.`),
              SORREL(`What worries me is that I know the customer, somewhere. I just can't pull it up. It's like a word on the tip of your tongue.`),
              HOLLIS(`Take your time.`),
            ],
          },
        ],
      },
      SORREL(`It was after closing. Raining sideways. The customer came to the shutter, not the door.`),
      REEVE(`Man or woman?`),
      SORREL(`A hood. Grey, or a shawl, I couldn't swear which. And a small voice. Polite.`),
      REEVE(`Polite how?`),
      SORREL(`"Thank you ever so much, dear." Said it twice. Left coin on the counter and didn't wait for change.`),
      HOLLIS(`A customer who does not wait for change. Remarkable.`),
      SORREL(`That's what I thought. Nobody in Harrowmere skips their change.`),
      {
        choice: [
          {
            label: 'Show the receipt',
            pick: REEVE(`Here is your own sales receipt for the chain. Does the date jog your memory?`),
            then: [
              SORREL(`Third of the month. A Saturday. Aye, the night Corin went.`),
              SORREL(`I wrote it down because I charged double. The gale was already coming. Everyone was buying.`),
              HOLLIS(`Double. Of course you did.`),
            ],
          },
          {
            label: 'Mention the Pale Heron',
            pick: REEVE(`The Pale Heron was tied with a knot only an outsider would use. Did anyone ask you for a knot-book?`),
            then: [
              SORREL(`A knot-book? Aye! I sold one that week, second-hand. Same customer, I think. I'd forgotten.`),
              SORREL(`She wanted the one with the fancy ones. Right over left, she said. For a nephew.`),
              REEVE(`She.`),
              SORREL(`I said she, didn't I? Did I say she?`),
            ],
          },
        ],
      },
      HOLLIS(`Miss Brant, think carefully. Anything else about the voice?`),
      SORREL(`Lavender. She smelled of lavender soap. And her hands were soft, no nets.`),
      REEVE(`Thank you, Miss Brant. You have helped more than you know.`),
      SORREL(`Don't thank me. Just don't tell Hetty I'm talking to the Tidewatch. She'll call me a collaborator.`),
      HOLLIS(`Your name stays out of it.`),
      SORREL(`Good. Now, will either of you buy something? Standing around makes a shop look empty.`),
      HOLLIS(`A box of matches, Miss Brant. I will pay the honest price.`),
      SORREL(`Honest price, then. And thank you, Inspector. Anything else?`),
    ],
  },
  {
    key: 'c3.turn',
    title: 'Dunnock Quay, midnight: Hollis lets go',
    section: CH3,
    description: 'The turning point: from stiff formality to first names.',
    entries: [
      SAY(`The tide is low. The quay is empty but for two lanterns.`),
      HOLLIS(`You are not asleep, Constable.`),
      REEVE(`Neither are you, Inspector.`),
      HOLLIS(`I do not sleep during an open case. It is a habit and a flaw.`),
      REEVE(`May I ask you something, Inspector?`),
      HOLLIS(`You may ask.`),
      REEVE(`Why did Oswin Tarn say "and you know why" to you on the Steps?`),
      HOLLIS(`...Because he is the only man in Harrowmere who remembers Wendell Rusk.`),
      HOLLIS(`Wendell was my partner. Fifteen years ago, on a case very like this one, a man vanished from the quay.`),
      HOLLIS(`I followed a lead to Skerrin Rock, ignored the tide and ignored Wendell. He went in after the man. The sea kept him.`),
      REEVE(`I am sorry, Inspector.`),
      HOLLIS(`Do not be. I am telling you so you understand my rules. I do not scold because I am cruel. I scold because I am frightened.`),
      REEVE(`Frightened of what?`),
      HOLLIS(`Of having a second person to bury.`),
      REEVE(`You were right to make us wait for the tide yesterday.`),
      HOLLIS(`That was luck. You, on the other hand, saw the knot before I did. I should have said so at once.`),
      HOLLIS(`I am saying it now. Well done, Reeve.`),
      {
        choice: [
          {
            label: 'Formal reply',
            pick: REEVE(`Thank you, Inspector. It means a great deal.`),
            then: [
              HOLLIS(`...Stop calling me Inspector at midnight. It makes me feel like a statue.`),
              REEVE(`Then what should I call you?`),
              HOLLIS(`Dorian. If you must call me something.`),
            ],
          },
          {
            label: 'Warm reply',
            pick: REEVE(`You are not as terrifying as you pretend to be, Dorian.`),
            then: [
              HOLLIS(`...Dorian. Well. That is the first time in fifteen years anyone has said it without a warrant in their hand.`),
              HOLLIS(`I will let it pass. This once.`),
            ],
          },
        ],
      },
      HOLLIS(`And you are... {player}, is it not? I have been calling you "Constable" like a coward.`),
      REEVE(`{player}. Yes. Everyone at the academy called me Rookie.`),
      HOLLIS(`Then we will have to do better than the academy. {player}.`),
      REEVE(`Dorian.`),
      HOLLIS(`Good. Now. Four nights, one boy. Tell me what you think of Miss Fenwick's grey shawl.`),
      REEVE(`I think Miss Fenwick is the kindest person in Harrowmere, and half the town owns a shawl like it.`),
      HOLLIS(`Half the town. Yes. I suppose that is true.`),
      REEVE(`You do not sound convinced.`),
      HOLLIS(`I am not convinced of anything. I am only awake.`),
    ],
  },
  {
    key: 'c3.dawn',
    title: 'The Brine Steps at dawn',
    section: CH3,
    entries: [
      REEVE(`Dorian, you have a crumb of toast on your collar.`),
      HOLLIS(`That is evidence of breakfast, not a crime.`),
      REEVE(`You had breakfast?`),
      HOLLIS(`Edda sent a basket. She said I looked "peaky." I have not looked peaky in thirty years.`),
      REEVE(`You looked peaky yesterday, Old Gull.`),
      HOLLIS(`I will have you know I am a lion in a gull's coat. And you, Rookie, are a menace.`),
      PIPPA(`Mister Gull! Lady constable! Look, I made you a paper gull!`),
      HOLLIS(`It has a very fine beak. Thank you, Miss Ashdale.`),
      PIPPA(`It's for luck. Grander Tarn says luck is just hard work wearing a hat.`),
      REEVE(`Then we will wear it proudly. Thank you, Pippa.`),
      OSWIN(`Mornin', you two. Meet me at the Brine Steps in twenty minutes. The tide's right. If you want Skerrin Rock, we leave within the hour.`),
      HOLLIS(`Tarn, we will be ready in thirty minutes.`),
      OSWIN(`Make it twenty. The tide-glass says calm, but it lies on Tuesdays. The causeway shuts at noon.`),
    ],
  },
  {
    key: 'c3.crier',
    title: 'Town crier, reward notice',
    section: CH3,
    description: 'A public notice; the crier speaks to the whole square.',
    entries: [
      CRIER(`Hear ye, Harrowmere! A reward of fifty silver, offered by the Net-Menders' Union, for any word of Corin Ashdale!`),
      CRIER(`The Greywater Ferry runs again at noon. All passengers must show their tickets, and their manners!`),
      CRIER(`Reminder: the outer pier remains closed, and Lowtide Market is open until dusk, rain or shine. The Tidewatch will fine trespassers.`),
      P2(`Fifty silver! I'd tell them my own mother's secrets for that.`),
      P3(`You'd tell them your mother's secrets for a mackerel.`),
    ],
  },
  {
    key: 'c3.radio',
    title: 'Gull Lamp radio, morning bulletin',
    section: CH3,
    entries: [
      RADIO(`Gull Lamp, Skerrin Rock, morning bulletin. Sea state moderate. The causeway opens at ten past eleven and closes at noon.`),
      RADIO(`Visitors to the island must report to the keeper at the lower door. Not the upper door. The upper door is locked.`),
      MORROW(`This is the keeper. A reminder to all: the Fogbell chamber is closed. Do not climb the stair. Do not ring the bell. I will not say it again.`),
      RADIO(`End of bulletin. Gull Lamp out.`),
    ],
  },
];

const ch3Docs: Doc[] = [
  {
    key: 'c3.page',
    title: 'Notebook page: suspects and questions',
    section: CH3,
    lines: [
      `<b>{player} Reeve — Notebook, Day Five</b>`,
      `Facts:\n- Corin Ashdale vanished Saturday night.\n- The Pale Heron was tied with a right-over-left knot.\n- Eleven pages are gone from the Mooring Ledger.`,
      `Heard:\n- A hooded customer bought chain, a padlock and a knot-book at Sorrel's.\n- A grey Tidewatch-coloured skiff left the pier around ten.`,
      `Unknown:\n- Who tied the knot?\n- Who knows the jiggle of the cabinet key?\n- Where was Corin going to "tell someone he trusts"?`,
      `Note to self: ask Oswin about the fogbell chamber. Do not forget the tide.`,
    ],
  },
];

// ───────────────────────── Chapter 4 ─────────────────────────
const ch4: Scene[] = [
  {
    key: 'c4.boat',
    title: 'Oswin\'s skiff to Skerrin Rock',
    section: CH4,
    entries: [
      OSWIN(`Sit low, both of you. The Rock doesn't like tall people.`),
      HOLLIS(`I am not afraid of the sea, Tarn.`),
      OSWIN(`Then why is your face the colour of porridge, Dorian?`),
      REEVE(`He is seasick, Mr. Tarn. He has been seasick since the pier.`),
      HOLLIS(`I am thinking. That is how it looks.`),
      REEVE(`Dorian, that is the worst excuse I have ever heard.`),
      HOLLIS(`Rookie, one more word and I will make you row.`),
      OSWIN(`Ha! Listen to them. A fortnight ago she was "Inspector, yes sir, no sir."`),
      REEVE(`A fortnight ago, he was "Constable Reeve, you are late."`),
      HOLLIS(`I was right. You were late.`),
      OSWIN(`She's got your number, Old Gull.`),
      HOLLIS(`I thought we agreed nobody calls me that.`),
      REEVE(`We agreed nothing of the kind.`),
      SAY(`Spray lifts over the bow. Skerrin Rock rises out of the grey, the Gull Lamp pale in the daylight.`),
      OSWIN(`There she is. Forty years I've fished under that lamp and never once liked it.`),
      HOLLIS(`Why not?`),
      OSWIN(`It watches. You can feel it, lad, even in daylight.`),
      REEVE(`Mr. Tarn, is that the causeway?`),
      OSWIN(`Aye. We've got an hour before the sea closes it. Mind the weed, it's slick as lard.`),
    ],
  },
  {
    key: 'c4.keeper',
    title: 'The keeper\'s door',
    section: CH4,
    entries: [
      MORROW(`State your business.`),
      HOLLIS(`Inspector Hollis, Harrowmere Tidewatch. This is Constable Reeve. We have a warrant to search the island.`),
      MORROW(`Warrants don't climb stairs. Show me the paper.`),
      REEVE(`Here, sir. Signed by the harbour board.`),
      MORROW(`Hm. Morrow, keeper. Visitors keep to the lower stair. No smoking. No shouting. No touching the lamp.`),
      HOLLIS(`We are looking for Corin Ashdale. Has he been here?`),
      MORROW(`Nobody's been here. The ferry stopped a week ago.`),
      REEVE(`Then why does the Fogbell ring off the hour?`),
      MORROW(`Wind on the rope. I told the radio.`),
      REEVE(`The rope is frayed, you said. Not cut. Could we see it?`),
      MORROW(`It's in the chamber. The stair is locked. I lost the key in the gale.`),
      HOLLIS(`Lost.`),
      MORROW(`Lost. I'm a lighthouse keeper, not a locksmith.`),
      OSWIN(`Come on, Morrow, you've known me thirty years. Let them climb.`),
      MORROW(`...Lower stair only. And I'll be watching.`),
    ],
  },
  {
    key: 'c4.chamber',
    title: 'Under the Fogbell',
    section: CH4,
    entries: [
      HOLLIS(`The lower stair ends at the chamber door. Morrow cannot say we were not invited.`),
      REEVE(`Dorian, listen. There. Tapping. Three short, two long.`),
      HOLLIS(`It is the wind on the rope.`),
      REEVE(`The wind does not tap in a pattern.`),
      HOLLIS(`...No. No, it does not.`),
      CORIN(`Hello? Is somebody there? Please?`),
      REEVE(`Corin! Corin Ashdale! It's the Tidewatch!`),
      CORIN(`I knew it. I knew somebody would hear. I've been ringing for days.`),
      HOLLIS(`Hold on, lad. Reeve, the door. There is a chain, and a padlock.`),
      REEVE(`The same heavy chain as Sorrel's shop, I would swear to it. And it is new brass.`),
      CORIN(`Don't touch the lock! She said she'd come back with the key. She said she'd... oh. Someone's on the stair!`),
      EDDA(`Dorian? Dorian, dear, are you up there? I followed the Tidewatch skiff!`),
      HOLLIS(`Edda? Stay where you are! This is not safe!`),
      EDDA(`I couldn't bear to sit in that office, not knowing. I brought the spare key. I found it in the drawer.`),
      REEVE(`Dorian. Nobody told her what the lock was for. She brought the right key anyway.`),
      HOLLIS(`Not now, {player}.`),
      EDDA(`Look, look, here it is. Let me, my hands are steady. The lock sticks. You have to jiggle it.`),
      CORIN(`She knows how to do it. She does it every time. Please. Please don't let her do it again.`),
      HOLLIS(`...Edda. Stop.`),
    ],
  },
  {
    key: 'c4.confrontation',
    title: 'The confrontation on the stair',
    section: CH4,
    entries: [
      EDDA(`Whatever is the matter, Dorian? The boy's frightened. Let me open it.`),
      REEVE(`Miss Fenwick. Step away from the door.`),
      EDDA(`Dear, you're shaking. Let me.`),
      REEVE(`Step away, please.`),
      HOLLIS(`Edda, why do you smell of lavender?`),
      EDDA(`Because I'm a woman who bathes, Dorian. What a silly question.`),
      REEVE(`Sorrel Brant said the person who bought the chain smelled of lavender. And said "thank you ever so much, dear." Twice.`),
      EDDA(`Half of Harrowmere says "dear." I say it to everyone.`),
      REEVE(`You said you found the cabinet open. You said whoever did it knew the jiggle. Nobody else on the quay is allowed in that office, Miss Fenwick. You told us so on the first day.`),
      HOLLIS(`"Nobody touches it but me." Those were your words, Edda.`),
      EDDA(`Dorian. Thirty years.`),
      HOLLIS(`I know. That is why I am asking.`),
      {
        choice: [
          {
            label: 'Accuse her',
            pick: REEVE(`Edda Fenwick, you locked Corin Ashdale in the Fogbell chamber and cut the Pale Heron adrift. Say it.`),
            then: [
              EDDA(`Oh, you clever girl.`),
              EDDA(`Yes. All right. Yes, I did.`),
            ],
          },
          {
            label: 'Appeal to her',
            pick: REEVE(`Edda, you fed half this town. Whatever you did, there was a reason. Tell me.`),
            then: [
              EDDA(`A reason! You see, Dorian? She understands.`),
              EDDA(`I did it, dear. All of it. And I would do it again.`),
            ],
          },
        ],
      },
      CORIN(`She's right outside, isn't she? Oh God. She brought me soup for two days.`),
      EDDA(`I did, didn't I? I never wanted him hungry.`),
      HOLLIS(`Why, Edda? Why would you do this to a boy who trusted you?`),
      EDDA(`The Union's pension fund was bleeding for ten years, Dorian. Ten! Wages, rents, my sister's care home. A few silver a month from phantom berths, and nobody ever missed it.`),
      EDDA(`Then clever Corin counted. He came to me, to me, because he trusted me. And I thought... if he tells Hetty, the whole hall burns.`),
      REEVE(`So you burned him instead.`),
      EDDA(`I kept him warm, dear. I kept him fed. I was going to let him out when the audit season passed.`),
      OSWIN(`Eddie girl. You cut the lad's own boat loose to make him a drowned man.`),
      EDDA(`Oswin, you of all people... I tied the knot the way my father taught me. The ferry way. Right over left. I forgot. I always forget that the Harrowmere way is left over right.`),
      OSWIN(`That's how I knew, you wretched fool. I just didn't want to know.`),
      HOLLIS(`Eleven pages. The cabinet. The padlock. The skiff with the grey hull. Edda, I let you hand me a cup of tea each morning.`),
      EDDA(`Dorian. Don't. You'll make me cry, and then I'll have to make you more tea.`),
      REEVE(`Give me the key.`),
      EDDA(`I think not, dear. The tide is turning. Do you hear it? The causeway is closing. In twenty minutes this stair floods to the third step.`),
      HOLLIS(`You would drown him?`),
      EDDA(`I would rather not. But I would rather the Union did not burn. So.`),
      SAY(`She opens her hand. The brass key falls through the grating into the dark water below.`),
      HOLLIS(`Edda!`),
      EDDA(`There. It's out of everyone's hands now. Isn't that restful?`),
      MORROW(`Stand aside, Fenwick. I've got bolt cutters in the lamp room. It's about time someone climbed the upper stair.`),
      REEVE(`Keeper Morrow! You said you had lost the key!`),
      MORROW(`I lied. Fenwick brought me that chain weeks ago and said the chamber was storing Union records. Told me to keep everyone out. I didn't ask why. I'm a fool, not a villain.`),
      HOLLIS(`We shall discuss that later. Cut it. Now.`),
      EDDA(`Oh, but you can't be rid of me so easily, Dorian. I was your clerk when you were young. I know every secret of your office.`),
      HOLLIS(`Then you will tell them to a judge, Fenwick.`),
      EDDA(`...Fenwick. Not Edda. Not Mother Hen. How cold.`),
      REEVE(`You made it so, Miss Fenwick.`),
    ],
  },
  {
    key: 'c4.rescue',
    title: 'Rescue as the tide rises',
    section: CH4,
    entries: [
      MORROW(`Hold the lantern. Steady. I'll take the chain at the second link.`),
      REEVE(`Water is coming through the grating. Hurry, Keeper!`),
      CORIN(`I can hear it! I can hear the sea!`),
      HOLLIS(`Corin, stand back from the door! Three steps back!`),
      CORIN(`I'm back! I'm back!`),
      SAY(`The cutters bite. The chain falls with a clang that rings through the whole tower.`),
      REEVE(`Corin! Can you walk?`),
      CORIN(`I think so. My legs have forgotten how.`),
      HOLLIS(`Lean on me. Reeve, take his other arm.`),
      CORIN(`Inspector Hollis? Constable? I'm so sorry. I should have gone to the Tidewatch. I went to her instead.`),
      HOLLIS(`You went to a friend. That is nothing to apologise for.`),
      EDDA(`Oh, it's always nothing to apologise for, until it isn't.`),
      G1(`Inspector! The second skiff's at the pier! Tarn said you'd need us!`),
      G2(`Where is she? Where's Miss Fenwick? We're ordered to take her in, sir.`),
      HOLLIS(`On the stair. Gently, Guard. She is a prisoner, not a criminal in a story.`),
      G2(`Yes, sir. Miss Fenwick? If you'd come with us, please.`),
      EDDA(`Of course, young man. Mind my shawl, it's the only one I have left.`),
      OSWIN(`Time, lads! The causeway! Everybody into the boat or the sea will have the lot of us!`),
      REEVE(`Dorian, the water is at my knees!`),
      HOLLIS(`Then run, {player}! Run!`),
    ],
  },
  {
    key: 'c4.quay',
    title: 'Dunnock Quay, morning after',
    section: CH4,
    entries: [
      PIPPA(`Cor! Cor! You're here! You're really here! I've been waiting on the Brine Steps all morning!`),
      CORIN(`Pip! Easy, easy, I'm made of glass right now.`),
      PIPPA(`I kept your scarf warm. And Gerald's ghost got his crumb. Every day.`),
      CORIN(`I knew you would. Come here, you little gull.`),
      HETTY(`Corin Ashdale, you owe this hall six hundred silver of explanations.`),
      CORIN(`I know, Hetty. I'll show every page. Starting with the ones Edda took.`),
      HETTY(`She took... oh. Oh, no. Not Edda.`),
      TOBY(`I never trusted that soup. No, I'm kidding. I'm so sorry, Cor.`),
      FISH(`Corin, lad! Come to Lowtide Market tomorrow and I'll give you a whole mackerel. Free, mind. Don't tell anyone.`),
      SORREL(`Free bandages for the boy, and a hot bun from my stall. And no, I won't send an invoice.`),
      OSWIN(`Lass. Rookie. You did well.`),
      REEVE(`Thank you, Mr. Tarn. It was a good tie, in the end. Left over right.`),
      OSWIN(`Aye. Harrowmere style.`),
      HOLLIS(`{player}. A word.`),
      REEVE(`Dorian?`),
      HOLLIS(`I owe you an apology. For the first week, and the Inspector business, and the porridge-faced seasickness.`),
      REEVE(`You are forgiven for two of those. The third, I am keeping for blackmail.`),
      HOLLIS(`You are a better detective than I was at your age.`),
      REEVE(`You are a better liar than I am at any age. You said you were not seasick.`),
      HOLLIS(`I will deny this conversation.`),
      CRIER(`Hear ye, Harrowmere! Corin Ashdale has been found alive and well on Skerrin Rock!`),
      CRIER(`The Tidewatch thanks all who searched. The Greywater Ferry runs on time, as promised!`),
      CROWD(`Hooray for the Tidewatch! Hooray for the Old Gull!`),
      HOLLIS(`Ignore them.`),
      REEVE(`I could not possibly. Old Gull.`),
    ],
  },
  {
    key: 'c4.notebook',
    title: 'Notebook, last page',
    section: CH4,
    entries: [
      REEVE(`Last page for now. The tide is going out and the Gull Lamp is lit.`),
      REEVE(`Edda Fenwick sat three feet from me for a fortnight and handed me tea. I never saw it.`),
      REEVE(`Kindness is not evidence. Neither is its absence.`),
      REEVE(`Corin will be fine. Pippa has already redrawn the Fogbell, with a face.`),
      REEVE(`Dorian says the posting here is permanent. I think I will unpack.`),
    ],
  },
  {
    key: 'c4.radio',
    title: 'Gull Lamp radio, evening sign-on',
    section: CH4,
    entries: [
      RADIO(`This is the Gull Lamp, Skerrin Rock, signing on. The sea is calm and the Fogbell is silent.`),
      RADIO(`A message for the harbour: Harrowmere, you may sleep.`),
    ],
  },
];

const ch4Docs: Doc[] = [
  {
    key: 'c4.ledgernote',
    title: 'Corin\'s ledger note',
    section: CH4,
    lines: [
      `Berth fees, autumn quarter: 311 silver paid, 208 recorded.`,
      `Eleven ghost berths, all in the same hand. Moorings that do not exist at Dunnock Quay.`,
      `If I tell Hetty, the hall will split. If I tell nobody, the fund dies. I'll ask someone steady first.`,
    ],
  },
  {
    key: 'c4.gazette',
    title: 'Newspaper clipping: Harrowmere Gazette',
    section: CH4,
    lines: [
      `HARROWMERE GAZETTE — Special Edition`,
      `<b>MISSING CLERK FOUND ALIVE ON SKERRIN ROCK</b>`,
      `Corin Ashdale, 24, was rescued from the old fogbell chamber of the Gull Lamp as the tide closed the causeway. He is weak but well.`,
      `The Tidewatch has taken a long-serving employee into custody in connection with the missing Union funds. Inspector Dorian Hollis declined to comment.`,
      `The Net-Menders' Union has thanked Constable {player} Reeve, whose "stubborn notebook" is credited with the breakthrough.`,
    ],
  },
];

// ───────────────────────── UI strings ─────────────────────────
const ui: [key: string, source: string][] = [
  ['ui.menu.new', 'New Game'],
  ['ui.menu.continue', 'Continue'],
  ['ui.menu.chapters', 'Chapters'],
  ['ui.menu.settings', 'Settings'],
  ['ui.menu.quit', 'Quit to Desktop'],
  ['ui.menu.notebook', "{player}'s Notebook"],
  ['ui.menu.inventory', 'Inventory'],
  ['ui.menu.map', 'Harbour Map'],
  ['ui.hud.day', 'Day {day}'],
  ['ui.hud.talk', 'Press {button} to talk'],
  ['ui.hud.examine', 'Press {button} to examine'],
  ['ui.hud.tide', 'Tide: {state}'],
  ['ui.hud.saved', 'Game saved.'],
  ['ui.obj.new', '<b>New objective:</b> {objective}'],
  ['ui.obj.done', '<b>Objective complete:</b> {objective}'],
  ['ui.obj.find', 'Find Corin Ashdale'],
  ['ui.obj.ledger', 'Compare the Mooring Ledger with the Union books'],
  ['ui.obj.knot', 'Find out who tied the knot on the Pale Heron'],
  ['ui.obj.rock', 'Search Skerrin Rock before the causeway closes'],
  ['ui.item.got', 'You picked up {item}.'],
  ['ui.item.used', 'You used {item}.'],
  ['ui.item.scarf', "Pippa's Red Scarf"],
  ['ui.item.scarf.desc', 'Hand-knitted wool, still damp.\nIt smells of seawater and cedar.'],
  ['ui.item.tideglass', 'Tide-Glass'],
  ['ui.item.tideglass.desc', 'A brass barometer. Its needle trembles before every storm.'],
  ['ui.item.coat', "Corin's Pea-Coat"],
  ['ui.item.coat.desc', 'Heavy blue wool. There is a letter sealed in the inside pocket.'],
  ['ui.item.page', 'Mooring Ledger Page'],
  ['ui.item.page.desc', 'One of eleven missing pages. The ink is fresh.'],
  ['ui.item.boathook', 'Brass Boathook'],
  ['ui.item.paper', "Pippa's Paper Gull"],
  ['ui.notebook.add', 'Added to notebook: <i>{entry}</i>'],
  ['ui.choice.hint', 'Choose a reply'],
  ['ui.settings.volume', 'Master volume'],
  ['ui.settings.text', 'Text speed'],
  ['ui.settings.confirm', 'Return to the title screen?\nUnsaved progress will be lost.'],
];

// ───────────────────────── Builder ─────────────────────────
const NODE_TYPES: NonNullable<ImportFileInput['graph']>['nodeTypes'] = {
  Line: { kind: 'script', label: 'Dialogue line', description: 'Shows one line of dialogue.' },
  ChoicePrompt: { kind: 'condition', label: 'Choice fork', description: 'The player picks one reply; each outgoing edge carries the reply text.' },
  ChoiceOption: { kind: 'choice', label: 'Player reply', description: 'A reply the player can pick; its text is also a line.' },
  Join: { kind: 'connector', label: 'Join', description: 'Branches meet again here and the story goes on.' },
  Hub: { kind: 'connector', label: 'Map hub', description: 'The player may visit the following scenes in any order.' },
};

type Graph = NonNullable<ImportFileInput['graph']>;
const groups: ImportFileInput['groups'] = [];
const units: ImportFileInput['units'] = [];
const nodes: Graph['nodes'] = [];
const edges: Graph['edges'] = [];

const isChoice = (entry: Entry): entry is Choice => !Array.isArray(entry) || (entry as unknown as { choice?: unknown }).choice !== undefined;

/** Adds a scene's units and graph nodes; returns its first node and the nodes the next scene should follow. */
function addScene(scene: Scene, order: number) {
  groups.push({ key: scene.key, kind: 'scene', title: scene.title, ...(scene.description ? { description: scene.description } : {}), section: scene.section, order });
  let line = 0;
  let choices = 0;
  let first = '';
  const addUnit = ([speaker, text]: Line) => {
    const key = `${scene.key}.${String(++line).padStart(3, '0')}`;
    units.push({ key, group: scene.key, order: line, kind: 'dialogue', ...(speaker ? { speaker } : {}), source: text, tags: [] });
    return key;
  };
  const link = (tails: string[], to: string, label?: string) => {
    if (!first) first = to;
    for (const from of tails) edges.push({ from, to, ...(label ? { label } : {}) });
  };
  const walk = (entries: Entry[], tails: string[]): string[] => {
    for (const entry of entries) {
      if (isChoice(entry)) {
        const id = `${scene.key}.c${++choices}`;
        nodes.push({ key: `n.${id}`, type: 'ChoicePrompt', label: 'Choose a reply', group: scene.key });
        link(tails, `n.${id}`);
        const ends: string[] = [];
        entry.choice.forEach((option, index) => {
          const unit = addUnit(option.pick);
          const node = `n.${unit}`;
          nodes.push({ key: node, type: 'ChoiceOption', units: [unit] });
          edges.push({ from: `n.${id}`, to: node, label: option.label ?? `Reply ${index + 1}` });
          ends.push(...walk(option.then ?? [], [node]));
        });
        nodes.push({ key: `n.${id}.join`, type: 'Join', group: scene.key });
        for (const end of ends) edges.push({ from: end, to: `n.${id}.join` });
        tails = [`n.${id}.join`];
      } else {
        const unit = addUnit(entry);
        nodes.push({ key: `n.${unit}`, type: 'Line', units: [unit] });
        link(tails, `n.${unit}`);
        tails = [`n.${unit}`];
      }
    }
    return tails;
  };
  const tails = walk(scene.entries, []);
  return { first, tails };
}

function addDoc(doc: Doc, order: number) {
  groups.push({ key: doc.key, kind: 'document', title: doc.title, section: doc.section, order });
  doc.lines.forEach((text, index) => units.push({ key: `${doc.key}.${String(index + 1).padStart(2, '0')}`, group: doc.key, order: index + 1, kind: 'document', source: text, tags: [] }));
}

let order = 0;
const placed = new Map<string, ReturnType<typeof addScene>>();
const place = (scene: Scene) => {
  const result = addScene(scene, order++);
  placed.set(scene.key, result);
  return result;
};
/** Story order: scenes follow each other; `parallel` scenes are visited in any order between a hub and a join. */
let tails: string[] = [];
const follow = (scene: Scene) => {
  const { first, tails: next } = place(scene);
  for (const from of tails) edges.push({ from, to: first });
  tails = next;
};

for (const scene of ch1.filter((s) => ['c1.ferry', 'c1.quay', 'c1.office', 'c1.notebook'].includes(s.key))) follow(scene);
{
  // After the first morning the player may visit three places in any order.
  nodes.push({ key: 'h.c1.map', type: 'Hub', label: 'Harrowmere: three places to visit', group: 'c1.notebook' });
  for (const from of tails) edges.push({ from, to: 'h.c1.map' });
  nodes.push({ key: 'j.c1.map', type: 'Join', label: 'Evening', group: 'c1.radio' });
  for (const key of ['c1.market', 'c1.steps', 'c1.crier']) {
    const { first, tails: end } = place(ch1.find((s) => s.key === key)!);
    edges.push({ from: 'h.c1.map', to: first, label: ch1.find((s) => s.key === key)!.title });
    for (const from of end) edges.push({ from, to: 'j.c1.map' });
  }
  tails = ['j.c1.map'];
}
follow(ch1.find((s) => s.key === 'c1.radio')!);
ch1Docs.forEach((doc) => addDoc(doc, order++));
const ch3Order = ['c3.gate', 'c3.ledger', 'c3.notebook', 'c3.market', 'c3.interrogation', 'c3.turn', 'c3.crier', 'c3.radio', 'c3.dawn'].map((key) => ch3.find((s) => s.key === key)!);
for (const scene of [...ch2, ...ch3Order]) {
  follow(scene);
  if (scene.key === 'c2.radio') ch2Docs.forEach((doc) => addDoc(doc, order++));
}
ch3Docs.forEach((doc) => addDoc(doc, order++));
for (const scene of ch4) follow(scene);
ch4Docs.forEach((doc) => addDoc(doc, order++));

groups.push({ key: 'ui', kind: 'ui', title: 'Menus, objectives and items', section: 'Interface', order: order++ });
ui.forEach(([key, source], index) => units.push({ key, group: 'ui', order: index + 1, kind: 'ui', source, tags: ['UI'] }));

const file: ImportFileInput = {
  format: 'loca/v1',
  project: {
    name: PROJECT_NAME,
    description:
      'An original harbour-town missing-person mystery in four chapters (English → Korean), written for this repository. It carries only lines, speakers and the dialogue graph: characters, relationships, events, terms and speech rules are left empty so the workbench workflows can extract them. Scene order follows the story; the text is not taken from any game, book or film.',
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    formatRules: { presets: ['brace', 'angleTag'], custom: [] },
  },
  groups,
  units,
  graph: { nodeTypes: NODE_TYPES, nodes, edges },
  characters: [],
  relationships: [],
  documents: [],
  terms: [],
  events: [],
  speechRules: [],
};

importFileSchema.parse(file); // never ship a sample the importer would reject

// ── self-checks and a summary ──
const plain = (text: string) => text.replace(/<[^>]+>/g, '');
const TERMS = ['Harrowmere', 'Dunnock Quay', 'Skerrin Rock', 'Brine Steps', 'Lowtide Market', 'Tidewatch', 'Pale Heron', 'Brindle Gale', 'Fogbell', 'Gull Lamp', 'Greywater Ferry', "Net-Menders' Union", 'Mooring Ledger', 'Tide-Glass'];
const termCounts = Object.fromEntries(TERMS.map((term) => [term, units.filter((unit) => plain(unit.source).toLowerCase().includes(term.toLowerCase())).length]));
const rare = Object.entries(termCounts).filter(([, count]) => count < 3);
if (rare.length) throw new Error(`terms in fewer than 3 lines: ${rare.map(([term, count]) => `${term} ${count}`).join(', ')}`);
const speakers = new Map<string, number>();
for (const unit of units) if (unit.speaker) speakers.set(unit.speaker, (speakers.get(unit.speaker) ?? 0) + 1);

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../samples');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'showcase.loca.json'), `${JSON.stringify(file, null, 1)}\n`);

const count = (kind: string) => groups.filter((group) => group.kind === kind).length;
const sizes = groups.filter((group) => group.kind === 'scene').map((group) => units.filter((unit) => unit.group === group.key).length);
console.log(`showcase.loca.json: ${units.length} lines, ${groups.length} groups (scene ${count('scene')}, document ${count('document')}, ui ${count('ui')}), ${nodes.length} nodes, ${edges.length} edges`);
console.log(`largest scene ${Math.max(...sizes)} lines, median ${[...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}`);
console.log(`speakers (${speakers.size}): ${[...speakers].map(([name, n]) => `${name} ${n}`).join(', ')}`);
console.log(`terms (lines containing): ${Object.entries(termCounts).map(([term, n]) => `${term} ${n}`).join(', ')}`);
