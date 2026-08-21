// source_url is required to be a real amazon.com link. Where an item has its
// own confirmed Amazon product page (all 7 films; Camp Cretaceous seasons
// 1-3, sold together as one "Seasons One-Three" DVD; the two shorts, which
// are bonus features on the Dominion Blu-ray), that specific product page is
// used. Where no individual Amazon product actually exists (Camp Cretaceous
// seasons 4-5 and all of Chaos Theory are Netflix-exclusive titles with no
// confirmed standalone Amazon listing as of this writing), an amazon.com
// search-results link is used instead of guessing/fabricating a product
// page that may not exist — still a real, working amazon.com URL.
const CAMP_CRETACEOUS_123 = 'https://www.amazon.com/Jurassic-World-Cretaceous-Seasons-Three/dp/B09TLB5BLF';
const DOMINION_BLURAY_WITH_SHORTS = 'https://www.amazon.com/Jurassic-World-Dominion-Extended-Blu-ray/dp/B0B3H3FZGW';

module.exports = [
  { type: 'movie', title: 'Jurassic Park (1993)', sort_order: 1, source_url: 'https://www.amazon.com/Jurassic-Park-Blu-ray-Sam-Neill/dp/B07739NG1Q' },
  { type: 'movie', title: 'The Lost World: Jurassic Park (1997)', sort_order: 2, source_url: 'https://www.amazon.com/Lost-World-Jurassic-Park-Blu-ray/dp/B0773C7XSQ' },
  { type: 'movie', title: 'Jurassic Park III (2001)', sort_order: 3, source_url: 'https://www.amazon.com/Jurassic-Park-III-Blu-ray-Neill/dp/B07731LM4G' },
  { type: 'movie', title: 'Jurassic World (2015)', sort_order: 4, source_url: 'https://www.amazon.com/Jurassic-World-Blu-ray-Chris-Pratt/dp/B091F77VBN' },
  { type: 'movie', title: 'Jurassic World: Fallen Kingdom (2018)', sort_order: 5, source_url: 'https://www.amazon.com/Jurassic-World-Fallen-Kingdom-Blu-ray/dp/B07DQ3ZWYS' },
  { type: 'movie', title: 'Jurassic World Dominion (2022)', sort_order: 6, source_url: DOMINION_BLURAY_WITH_SHORTS },
  { type: 'movie', title: 'Jurassic World Rebirth (2025)', sort_order: 7, source_url: 'https://www.amazon.com/Jurassic-World-Rebirth-Blu-ray-Digital/dp/B0FCYYBT6X' },
  { type: 'series', title: 'Jurassic World: Camp Cretaceous - Season 1 (2020)', sort_order: 8, source_url: CAMP_CRETACEOUS_123 },
  { type: 'series', title: 'Jurassic World: Camp Cretaceous - Season 2 (2021)', sort_order: 9, source_url: CAMP_CRETACEOUS_123 },
  { type: 'series', title: 'Jurassic World: Camp Cretaceous - Season 3 (2021)', sort_order: 10, source_url: CAMP_CRETACEOUS_123 },
  { type: 'series', title: 'Jurassic World: Camp Cretaceous - Season 4 (2021)', sort_order: 11, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Camp+Cretaceous+Season+4' },
  { type: 'series', title: 'Jurassic World: Camp Cretaceous - Season 5 (2022)', sort_order: 12, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Camp+Cretaceous+Season+5' },
  { type: 'series', title: 'Jurassic World: Chaos Theory - Season 1 (2024)', sort_order: 13, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Chaos+Theory+Season+1+Blu-ray' },
  { type: 'series', title: 'Jurassic World: Chaos Theory - Season 2 (2024)', sort_order: 14, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Chaos+Theory+Season+2+Blu-ray' },
  { type: 'series', title: 'Jurassic World: Chaos Theory - Season 3 (2025)', sort_order: 15, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Chaos+Theory+Season+3+Blu-ray' },
  { type: 'series', title: 'Jurassic World: Chaos Theory - Season 4 (2025)', sort_order: 16, source_url: 'https://www.amazon.com/s?k=Jurassic+World+Chaos+Theory+Season+4+Blu-ray' },
  { type: 'movie', title: 'Battle at Big Rock (2019 short film)', sort_order: 17, source_url: DOMINION_BLURAY_WITH_SHORTS },
  { type: 'movie', title: 'Jurassic World Dominion Prologue (2021 short film)', sort_order: 18, source_url: DOMINION_BLURAY_WITH_SHORTS },
];

// Titles that used to represent a whole series as one row, now superseded by
// per-season rows above. Kept here so db/index.js can replace the old row
// with the new season rows on startup without losing an existing
// owns_physical_copy checkmark (it gets carried onto every season row).
module.exports.supersededTitles = {
  'Jurassic World: Camp Cretaceous': [
    'Jurassic World: Camp Cretaceous - Season 1 (2020)',
    'Jurassic World: Camp Cretaceous - Season 2 (2021)',
    'Jurassic World: Camp Cretaceous - Season 3 (2021)',
    'Jurassic World: Camp Cretaceous - Season 4 (2021)',
    'Jurassic World: Camp Cretaceous - Season 5 (2022)',
  ],
  'Jurassic World: Chaos Theory': [
    'Jurassic World: Chaos Theory - Season 1 (2024)',
    'Jurassic World: Chaos Theory - Season 2 (2024)',
    'Jurassic World: Chaos Theory - Season 3 (2025)',
    'Jurassic World: Chaos Theory - Season 4 (2025)',
  ],
};
