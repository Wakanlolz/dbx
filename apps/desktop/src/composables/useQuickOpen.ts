import { computed, ref } from "vue";
import type { ConnectionConfig } from "@/types/database";
import { useConnectionStore } from "@/stores/connectionStore";

export interface QuickOpenItem {
  id: string;
  type: "connection" | "database" | "table";
  label: string;
  description?: string;
  connectionId: string;
  database?: string;
  schema?: string;
  tableName?: string;
  connectionName?: string;
  searchText: string; // Lowercase text for searching
}

/**
 * Fuzzy match function that checks if query matches text
 * Returns the matched indices for highlighting
 */
function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  if (!lowerQuery) return { score: Infinity, indices: [] };
  if (lowerText.includes(lowerQuery)) {
    // Exact substring match gets highest score
    const startIdx = lowerText.indexOf(lowerQuery);
    return {
      score: 1,
      indices: Array.from({ length: lowerQuery.length }, (_, i) => startIdx + i),
    };
  }

  // Fuzzy match: find all characters in order
  let queryIdx = 0;
  const indices: number[] = [];
  let score = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < lowerText.length && queryIdx < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIdx]) {
      indices.push(i);
      // Score based on proximity (consecutive chars score better)
      score += lastMatchIdx === i - 1 ? 2 : 1;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx === lowerQuery.length) {
    return { score: score / lowerQuery.length, indices };
  }

  return null;
}

interface MatchedItem extends QuickOpenItem {
  matchScore: number;
  matchIndices: number[];
}

export function useQuickOpen() {
  const connectionStore = useConnectionStore();
  const searchQuery = ref("");
  const selectedIndex = ref(0);

  const allItems = computed((): QuickOpenItem[] => {
    const items: QuickOpenItem[] = [];
    const connections = connectionStore.connections;

    // Add connections
    for (const conn of connections) {
      items.push({
        id: `conn-${conn.id}`,
        type: "connection",
        label: conn.name,
        connectionId: conn.id,
        connectionName: conn.name,
        searchText: `${conn.name}`,
      });
    }

    // Add databases and tables
    for (const conn of connections) {
      const treeNodes = connectionStore.getTreeNodes(conn.id);
      if (!treeNodes) continue;

      // Process tree nodes to extract databases and tables
      processDatabaseTreeNodes(treeNodes, conn, items);
    }

    return items;
  });

  function processDatabaseTreeNodes(nodes: any[], conn: ConnectionConfig, items: QuickOpenItem[]): void {
    for (const node of nodes) {
      // Skip certain node types
      if (node.type === "group" || node.type === "linked-server-root") {
        if (node.children) {
          processDatabaseTreeNodes(node.children, conn, items);
        }
        continue;
      }

      // Database nodes
      if (node.type === "database" && node.database) {
        items.push({
          id: `db-${conn.id}-${node.database}`,
          type: "database",
          label: node.label || node.database,
          description: conn.name,
          connectionId: conn.id,
          database: node.database,
          connectionName: conn.name,
          searchText: `${conn.name} ${node.database}`,
        });
      }

      // Schema nodes - skip them but process their tables
      if (node.type === "schema" && node.children) {
        processDatabaseTreeNodes(node.children, conn, items);
        continue;
      }

      // Table nodes
      if (node.type === "table" && node.database && node.label) {
        items.push({
          id: `table-${conn.id}-${node.database}-${node.schema || ""}-${node.label}`,
          type: "table",
          label: node.label,
          description: `${conn.name} / ${node.database}${node.schema ? " / " + node.schema : ""}`,
          connectionId: conn.id,
          database: node.database,
          schema: node.schema,
          tableName: node.label,
          connectionName: conn.name,
          searchText: `${conn.name} ${node.database} ${node.schema || ""} ${node.label}`,
        });
      }

      // Process children recursively
      if (node.children) {
        processDatabaseTreeNodes(node.children, conn, items);
      }
    }
  }

  const filteredItems = computed((): MatchedItem[] => {
    if (!searchQuery.value.trim()) {
      return allItems.value.map((item) => ({
        ...item,
        matchScore: Infinity,
        matchIndices: [],
      }));
    }

    const matched: MatchedItem[] = [];

    for (const item of allItems.value) {
      const result = fuzzyMatch(searchQuery.value, item.searchText);
      if (result) {
        matched.push({
          ...item,
          matchScore: result.score,
          matchIndices: result.indices,
        });
      }
    }

    // Sort by score and type (connections > databases > tables for equal scores)
    matched.sort((a, b) => {
      if (a.matchScore !== b.matchScore) {
        return a.matchScore - b.matchScore;
      }

      const typeOrder = { connection: 0, database: 1, table: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    });

    return matched;
  });

  const selectedItem = computed((): MatchedItem | null => {
    if (selectedIndex.value < 0 || selectedIndex.value >= filteredItems.value.length) {
      return null;
    }
    return filteredItems.value[selectedIndex.value];
  });

  function selectNext(): void {
    if (selectedIndex.value < filteredItems.value.length - 1) {
      selectedIndex.value++;
    }
  }

  function selectPrevious(): void {
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
  }

  function resetSelection(): void {
    selectedIndex.value = 0;
  }

  function setQuery(query: string): void {
    searchQuery.value = query;
    resetSelection();
  }

  return {
    searchQuery,
    filteredItems,
    selectedIndex,
    selectedItem,
    selectNext,
    selectPrevious,
    resetSelection,
    setQuery,
  };
}
