export const EMOJI_CATEGORIES = [
  {
    id: "recent",
    name: "Recent",
    icon: "lucide:clock",
    emojis: [],
  },
  {
    id: "smileys",
    name: "Smileys & Emotion",
    icon: "lucide:smile",
    emojis: [
      { emoji: "😀", name: "grinning", keywords: ["smile", "happy"] },
      { emoji: "😂", name: "joy", keywords: ["laugh", "tears"] },
      { emoji: "🤣", name: "rofl", keywords: ["laugh", "rolling"] },
      { emoji: "❤️", name: "heart", keywords: ["love", "red"] },
      { emoji: "😍", name: "heart_eyes", keywords: ["love", "crush"] },
      { emoji: "😊", name: "blush", keywords: ["smile", "happy"] },
      { emoji: "😎", name: "sunglasses", keywords: ["cool"] },
      { emoji: "🤔", name: "thinking", keywords: ["think", "hmm"] },
      { emoji: "👍", name: "thumbsup", keywords: ["yes", "good"] },
      { emoji: "👎", name: "thumbsdown", keywords: ["no", "bad"] },
      { emoji: "🎉", name: "tada", keywords: ["party", "celebrate"] },
      { emoji: "🙏", name: "pray", keywords: ["please", "hope"] },
      { emoji: "🔥", name: "fire", keywords: ["hot", "lit"] },
      { emoji: "💀", name: "skull", keywords: ["dead", "laugh"] },
      { emoji: "✨", name: "sparkles", keywords: ["magic", "shiny"] },
      { emoji: "💯", name: "100", keywords: ["perfect", "score"] },
      { emoji: "😭", name: "sob", keywords: ["cry", "sad"] },
      { emoji: "🥺", name: "pleading", keywords: ["puppy", "eyes"] },
      { emoji: "😡", name: "rage", keywords: ["angry", "mad"] },
      { emoji: "🤯", name: "exploding_head", keywords: ["mind", "blown"] },
      { emoji: "🥳", name: "partying_face", keywords: ["party", "celebrate"] },
      { emoji: "😴", name: "sleeping", keywords: ["sleep", "tired"] },
      { emoji: "😈", name: "smiling_imp", keywords: ["devil", "evil"] },
      { emoji: "🤗", name: "hugs", keywords: ["hug", "love"] },
      { emoji: "🤩", name: "star_struck", keywords: ["star", "excited"] },
    ],
  },
  {
    id: "gestures",
    name: "Gestures & People",
    icon: "lucide:hand",
    emojis: [
      { emoji: "👋", name: "wave", keywords: ["hello", "bye"] },
      { emoji: "✋", name: "raised_hand", keywords: ["stop", "highfive"] },
      { emoji: "👏", name: "clap", keywords: ["applause", "congrats"] },
      { emoji: "🙌", name: "raised_hands", keywords: ["hooray", "yes"] },
      { emoji: "🤝", name: "handshake", keywords: ["deal", "agree"] },
      { emoji: "💪", name: "flex", keywords: ["strong", "muscle"] },
      { emoji: "✌️", name: "victory", keywords: ["peace", "v"] },
      { emoji: "🤞", name: "crossed_fingers", keywords: ["luck", "hope"] },
      { emoji: "🖕", name: "middle_finger", keywords: ["fuck", "flip"] },
      { emoji: "👀", name: "eyes", keywords: ["look", "see"] },
      { emoji: "🙄", name: "roll_eyes", keywords: ["eyeroll"] },
      { emoji: "😏", name: "smirk", keywords: ["smug", "flirt"] },
    ],
  },
  {
    id: "objects",
    name: "Objects & Symbols",
    icon: "lucide:package",
    emojis: [
      { emoji: "🎁", name: "gift", keywords: ["present", "birthday"] },
      { emoji: "🎂", name: "birthday", keywords: ["cake", "party"] },
      { emoji: "💡", name: "bulb", keywords: ["idea", "light"] },
      { emoji: "📌", name: "pushpin", keywords: ["pin", "save"] },
      { emoji: "🔔", name: "bell", keywords: ["notification", "alert"] },
      { emoji: "📢", name: "loudspeaker", keywords: ["announce", "shout"] },
      { emoji: "💬", name: "speech_balloon", keywords: ["chat", "message"] },
      { emoji: "🗑️", name: "wastebasket", keywords: ["delete", "trash"] },
      { emoji: "🔒", name: "lock", keywords: ["secure", "private"] },
      { emoji: "🔓", name: "unlock", keywords: ["open", "unlocked"] },
      { emoji: "📎", name: "paperclip", keywords: ["attach", "file"] },
      { emoji: "🔍", name: "magnifying_glass", keywords: ["search", "find"] },
      { emoji: "🚀", name: "rocket", keywords: ["launch", "space"] },
      { emoji: "⭐", name: "star", keywords: ["favorite", "rating"] },
      { emoji: "🌈", name: "rainbow", keywords: ["color", "pride"] },
      { emoji: "🎵", name: "musical_note", keywords: ["music", "song"] },
      { emoji: "🎶", name: "notes", keywords: ["music", "melody"] },
      { emoji: "💰", name: "money_bag", keywords: ["money", "rich"] },
      { emoji: "👑", name: "crown", keywords: ["king", "royal"] },
      { emoji: "🗡️", name: "dagger", keywords: ["knife", "weapon"] },
    ],
  },
  {
    id: "nature",
    name: "Nature & Food",
    icon: "lucide:leaf",
    emojis: [
      { emoji: "🌺", name: "hibiscus", keywords: ["flower", "tropical"] },
      { emoji: "🌸", name: "cherry_blossom", keywords: ["flower", "spring"] },
      { emoji: "🌻", name: "sunflower", keywords: ["flower", "sun"] },
      { emoji: "🌹", name: "rose", keywords: ["flower", "love"] },
      { emoji: "🌵", name: "cactus", keywords: ["desert", "plant"] },
      { emoji: "🌴", name: "palm_tree", keywords: ["beach", "tropical"] },
      { emoji: "🍕", name: "pizza", keywords: ["food", "italian"] },
      { emoji: "🍔", name: "hamburger", keywords: ["food", "burger"] },
      { emoji: "🍺", name: "beer", keywords: ["drink", "alcohol"] },
      { emoji: "☕", name: "coffee", keywords: ["drink", "cafe"] },
      { emoji: "🍻", name: "clinking_glasses", keywords: ["cheers", "drink"] },
      { emoji: "🌊", name: "ocean", keywords: ["wave", "sea"] },
      { emoji: "☀️", name: "sunny", keywords: ["weather", "sun"] },
      { emoji: "❄️", name: "snowflake", keywords: ["cold", "winter"] },
      { emoji: "⚡", name: "zap", keywords: ["lightning", "power"] },
    ],
  },
  {
    id: "travel",
    name: "Travel & Places",
    icon: "lucide:map-pin",
    emojis: [
      { emoji: "✈️", name: "airplane", keywords: ["flight", "travel"] },
      { emoji: "🚗", name: "car", keywords: ["drive", "vehicle"] },
      { emoji: "🏠", name: "house", keywords: ["home", "building"] },
      { emoji: "🏢", name: "office", keywords: ["building", "work"] },
      { emoji: "🗽", name: "statue_of_liberty", keywords: ["nyc", "landmark"] },
      { emoji: "🏖️", name: "beach", keywords: ["vacation", "holiday"] },
      { emoji: "🌍", name: "earth", keywords: ["world", "global"] },
      { emoji: "🎪", name: "circus_tent", keywords: ["circus", "event"] },
      { emoji: "🎭", name: "performing_arts", keywords: ["theater", "drama"] },
    ],
  },
];

export const SKIN_TONES = [
  { emoji: "🏻", name: "light", description: "Light" },
  { emoji: "🏼", name: "medium_light", description: "Medium-Light" },
  { emoji: "🏽", name: "medium", description: "Medium" },
  { emoji: "🏾", name: "medium_dark", description: "Medium-Dark" },
  { emoji: "🏿", name: "dark", description: "Dark" },
];

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"];

interface EmojiSearchResult {
  emoji: string;
  name: string;
  keywords: string[];
  category: string;
}

export function searchEmojis(query: string): EmojiSearchResult[] {
  if (!query || query.length < 1) return [];
  const lower = query.toLowerCase();
  const results: EmojiSearchResult[] = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const item of category.emojis) {
      if (
        item.name.includes(lower) ||
        item.emoji === lower ||
        item.keywords.some((k) => k.includes(lower))
      ) {
        results.push({ ...item, category: category.id });
      }
    }
  }
  return results;
}

export function getRecentEmojis(): string[] {
  if (!import.meta.client) return [];
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem("dspeak_recent_emojis") || "[]",
    );
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function addRecentEmoji(emoji: string) {
  if (!import.meta.client) return;
  try {
    const recent = getRecentEmojis().filter((e) => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(
      "dspeak_recent_emojis",
      JSON.stringify(recent.slice(0, 20)),
    );
  } catch {}
}

export function applySkinTone(emoji: string, skinTone: string) {
  const skinToneBase = [
    "👋",
    "✋",
    "👌",
    "🤌",
    "🤏",
    "✌️",
    "🤞",
    "🫰",
    "🤟",
    "🤘",
    "🤙",
    "👈",
    "👉",
    "👆",
    "🖕",
    "👇",
    "☝️",
    "👍",
    "👎",
    "✊",
    "👊",
    "🤛",
    "🤜",
    "👏",
    "🙌",
    "🫶",
    "👐",
    "🤲",
    "🤝",
    "🙏",
    "✍️",
    "💅",
    "🤳",
    "💪",
    "🦵",
    "🦶",
    "👂",
    "🦻",
    "👃",
    "🧒",
    "👦",
    "👧",
    "🧑",
    "👱",
    "👨",
    "👩",
    "🧔",
    "👩‍🦰",
    "👨‍🦰",
    "👩‍🦱",
    "👨‍🦱",
    "👩‍🦳",
    "👨‍🦳",
    "👩‍🦲",
    "👨‍🦲",
    "🧑‍🦰",
    "🧑‍🦱",
    "🧑‍🦳",
    "🧑‍🦲",
  ];
  if (!skinTone || !skinToneBase.includes(emoji)) return emoji;
  return emoji + skinTone;
}
