/**
 * Sets a value in localStorage with the specified key.
 * @param key - The key under which to store the value.
 * @param value - The value to store. It will be automatically converted to JSON string if it's an object or array.
 */
export declare function setItem(key: string, value: any): void;
/**
 * Gets a value from localStorage by the specified key.
 * @param key - The key for which to retrieve the value.
 * @returns The stored value, parsed if it's a JSON string. Returns `null` if the key does not exist.
 */
export declare function getItem<T>(key: string): T | null;
/**
 * Removes a value from localStorage by the specified key.
 * @param key - The key of the item to remove.
 */
export declare function removeItem(key: string): void;
/**
 * Clears all items from localStorage.
 */
export declare function clear(): void;
export declare function localStorage(): Storage;
//# sourceMappingURL=localStore.d.ts.map