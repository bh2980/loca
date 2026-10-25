/** Forms of address are kept as one comma-separated string; these turn it into chips and back. */
export const splitList = (value: unknown) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : []);
export const joinList = (value: string[]) => value.join(', ');
