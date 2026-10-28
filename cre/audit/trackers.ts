/**
 * Known third-party tracker hosts, matched by domain suffix. Seeded by hand from public tracker lists
 * (DuckDuckGo Tracker Radar, EasyPrivacy); extend before a real audit. Category numbers match
 * HallMonitor.Category onchain.
 */
export enum Category {
  Unknown = 0,
  Advertising = 1,
  Analytics = 2,
  Social = 3,
  SessionReplay = 4,
  Fingerprinting = 5,
  TagManager = 6,
}

export type TrackerInfo = { entity: string; category: Category }

const T = (entity: string, category: Category): TrackerInfo => ({ entity, category })

export const TRACKERS: Record<string, TrackerInfo> = {
  "doubleclick.net": T("Google (DoubleClick)", Category.Advertising),
  "googlesyndication.com": T("Google AdSense", Category.Advertising),
  "googleadservices.com": T("Google Ads", Category.Advertising),
  "google-analytics.com": T("Google Analytics", Category.Analytics),
  "googletagmanager.com": T("Google Tag Manager", Category.TagManager),
  "connect.facebook.net": T("Meta Pixel", Category.Advertising),
  "facebook.com": T("Meta", Category.Advertising),
  "analytics.tiktok.com": T("TikTok Pixel", Category.Advertising),
  "ads-twitter.com": T("X Ads", Category.Advertising),
  "bat.bing.com": T("Microsoft Ads", Category.Advertising),
  "criteo.com": T("Criteo", Category.Advertising),
  "criteo.net": T("Criteo", Category.Advertising),
  "adnxs.com": T("Xandr", Category.Advertising),
  "taboola.com": T("Taboola", Category.Advertising),
  "outbrain.com": T("Outbrain", Category.Advertising),
  "scorecardresearch.com": T("comScore", Category.Advertising),
  "quantserve.com": T("Quantcast", Category.Advertising),
  "sc-static.net": T("Snap Pixel", Category.Advertising),
  "hotjar.com": T("Hotjar", Category.SessionReplay),
  "fullstory.com": T("FullStory", Category.SessionReplay),
  "clarity.ms": T("Microsoft Clarity", Category.SessionReplay),
  "mixpanel.com": T("Mixpanel", Category.Analytics),
  "segment.com": T("Segment", Category.Analytics),
  "segment.io": T("Segment", Category.Analytics),
  "amplitude.com": T("Amplitude", Category.Analytics),
  "fpjs.io": T("FingerprintJS", Category.Fingerprinting),
  "fingerprintjs.com": T("FingerprintJS", Category.Fingerprinting),
}

/** Longest matching suffix wins, so "connect.facebook.net" beats a bare "facebook.net" entry. */
export const lookupTracker = (host: string): TrackerInfo | undefined => {
  let best: string | undefined
  for (const suffix of Object.keys(TRACKERS)) {
    if ((host === suffix || host.endsWith("." + suffix)) && (!best || suffix.length > best.length)) best = suffix
  }
  return best ? TRACKERS[best] : undefined
}
