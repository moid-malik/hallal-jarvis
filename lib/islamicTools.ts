import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

// Define interfaces for API responses
interface QuranTranslation {
  text: string;
}

interface QuranTranslationResponse {
  translations: QuranTranslation[];
}

interface QuranVerse {
  text_uthmani: string;
}

interface QuranVerseResponse {
  verses: QuranVerse[];
}

interface QuranSearchResult {
  verse_key: string;
  text: string;
}

interface QuranSearchResponse {
  search: {
    results: QuranSearchResult[];
  };
}

interface HadithResponse {
  hadith: {
    body: string;
    translation: string;
    grade?: string;
  };
}

interface HadithSearchResult {
  collection: string;
  hadithNumber: string;
  translation: string;
}

interface HadithSearchResponse {
  data: HadithSearchResult[];
}

/**
 * Tool for retrieving Quran verses by surah and ayah numbers
 */
export const quranTool = new DynamicStructuredTool({
  name: "quran_verse",
  description: "Get a verse from the Quran by surah and ayah number",
  schema: z.object({
    surah: z.number().describe("The surah number (1-114)"),
    ayah: z.number().describe("The ayah number within the surah"),
    translation: z.string().optional().describe("Optional: The translation to use (default: 'en.sahih')"),
  }),
  func: async ({ surah, ayah, translation = "en.sahih" }: { surah: number; ayah: number; translation?: string }) => {
    try {
      // Validate input
      if (surah < 1 || surah > 114) {
        return "Error: Surah number must be between 1 and 114.";
      }

      // Use the Quran.com API to fetch the verse
      const response = await fetch(
        `https://api.quran.com/api/v4/quran/translations/${translation}?verse_key=${surah}:${ayah}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch Quran verse: ${response.statusText}`);
      }

      const data = await response.json() as QuranTranslationResponse;
      
      // Also fetch the Arabic text
      const arabicResponse = await fetch(
        `https://api.quran.com/api/v4/quran/verses/uthmani?verse_key=${surah}:${ayah}`
      );
      
      if (!arabicResponse.ok) {
        throw new Error(`Failed to fetch Arabic text: ${arabicResponse.statusText}`);
      }
      
      const arabicData = await arabicResponse.json() as QuranVerseResponse;
      
      // Format the response
      if (data.translations && data.translations.length > 0 && 
          arabicData.verses && arabicData.verses.length > 0) {
        const translationText = data.translations[0].text;
        const arabicText = arabicData.verses[0].text_uthmani;
        
        return `Quran ${surah}:${ayah}\n\nArabic: ${arabicText}\n\nTranslation: ${translationText}`;
      } else {
        return `Could not find verse ${surah}:${ayah}`;
      }
    } catch (error) {
      console.error("Error in quranTool:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error retrieving Quran verse: ${errorMessage}`;
    }
  },
});

/**
 * Tool for searching the Quran by keywords
 */
export const quranSearchTool = new DynamicStructuredTool({
  name: "quran_search",
  description: "Search the Quran for specific keywords or phrases",
  schema: z.object({
    query: z.string().describe("The keywords or phrase to search for"),
    translation: z.string().optional().describe("Optional: The translation to use (default: 'en.sahih')"),
    limit: z.number().optional().describe("Optional: Maximum number of results to return (default: 5)"),
  }),
  func: async ({ query, translation = "en.sahih", limit = 5 }: { query: string; translation?: string; limit?: number }) => {
    try {
      // Use the Quran.com API to search
      const response = await fetch(
        `https://api.quran.com/api/v4/search?q=${encodeURIComponent(query)}&size=${limit}&language=en&page=1&translations=${translation}`
      );

      if (!response.ok) {
        throw new Error(`Failed to search Quran: ${response.statusText}`);
      }

      const data = await response.json() as QuranSearchResponse;
      
      if (data.search && data.search.results && data.search.results.length > 0) {
        const results = data.search.results.map((result: QuranSearchResult) => {
          return `Quran ${result.verse_key}: ${result.text}`;
        });
        
        return `Search results for "${query}":\n\n${results.join('\n\n')}`;
      } else {
        return `No results found for "${query}" in the Quran.`;
      }
    } catch (error) {
      console.error("Error in quranSearchTool:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error searching the Quran: ${errorMessage}`;
    }
  },
});

/**
 * Tool for retrieving Hadith by collection and number
 */
export const hadithTool = new DynamicStructuredTool({
  name: "hadith_by_number",
  description: "Get a hadith by collection name and number",
  schema: z.object({
    collection: z.string().describe("The hadith collection (e.g., 'bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah')"),
    number: z.number().describe("The hadith number within the collection"),
  }),
  func: async ({ collection, number }: { collection: string; number: number }) => {
    try {
      // Normalize collection name
      const normalizedCollection = collection.toLowerCase().trim();
      
      // Use the Sunnah.com API to fetch the hadith
      const response = await fetch(
        `https://api.sunnah.com/v1/hadiths/${normalizedCollection}/${number}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "SqD712P3E82xnwOAEOkGd5JZH8s9wRR24TqNFzjk"  // This is a public API key for demo purposes
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch hadith: ${response.statusText}`);
      }

      const data = await response.json() as HadithResponse;
      
      if (data.hadith) {
        const hadith = data.hadith;
        return `Hadith: ${collection} ${number}\n\nArabic: ${hadith.body}\n\nTranslation: ${hadith.translation}\n\nGrade: ${hadith.grade || 'Not specified'}`;
      } else {
        return `Could not find hadith ${collection} ${number}`;
      }
    } catch (error) {
      console.error("Error in hadithTool:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error retrieving hadith: ${errorMessage}`;
    }
  },
});

/**
 * Tool for searching hadiths by keywords
 */
export const hadithSearchTool = new DynamicStructuredTool({
  name: "hadith_search",
  description: "Search hadiths for specific keywords or phrases",
  schema: z.object({
    query: z.string().describe("The keywords or phrase to search for"),
    collection: z.string().optional().describe("Optional: Specific collection to search (default: searches across all collections)"),
    limit: z.number().optional().describe("Optional: Maximum number of results to return (default: 5)"),
  }),
  func: async ({ query, collection, limit = 5 }: { query: string; collection?: string; limit?: number }) => {
    try {
      // Build the URL based on whether a specific collection is specified
      let url = `https://api.sunnah.com/v1/hadiths/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      if (collection) {
        url += `&collection=${collection.toLowerCase().trim()}`;
      }
      
      // Use the Sunnah.com API to search
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "SqD712P3E82xnwOAEOkGd5JZH8s9wRR24TqNFzjk"  // This is a public API key for demo purposes
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to search hadiths: ${response.statusText}`);
      }

      const data = await response.json() as HadithSearchResponse;
      
      if (data.data && data.data.length > 0) {
        const results = data.data.map((hadith: HadithSearchResult) => {
          return `${hadith.collection} ${hadith.hadithNumber}: ${hadith.translation}`;
        });
        
        return `Search results for "${query}":\n\n${results.join('\n\n')}`;
      } else {
        return `No results found for "${query}" in the hadith collections.`;
      }
    } catch (error) {
      console.error("Error in hadithSearchTool:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error searching hadiths: ${errorMessage}`;
    }
  },
});

// Export all tools as an array for easy integration
export const islamicTools = [
  quranTool,
  quranSearchTool,
  hadithTool,
  hadithSearchTool
];
