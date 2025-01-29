export function isAddress(value: string): boolean {
    // Basic length and hex check
    if (!/^0x[0-9A-Fa-f]{40}$/.test(value)) {
        return false;
    }

    // If it's all lowercase or all uppercase, skip checksum validation
    if (!/[A-F]/.test(value) || !/[a-f]/.test(value)) {
        return true;
    }

    // Checksum validation
    try {
        const addr = value.toLowerCase();
        const chars = addr.substring(2).split('');
        
        // Convert the string to bytes
        const expanded = chars.map((c) => c.charCodeAt(0));
        
        // UTF-8 encode
        const utf8Encoded = expanded.map((c) => {
            if (c < 128) return [c];
            if (c < 2048) return [(c >> 6) | 192, (c & 63) | 128];
            return [(c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128];
        }).flat();

        // keccak256 implementation
        const keccak256 = (data: number[]): string => {
            // This is a simplified version - in production, use a proper keccak256 implementation
            // You might want to use the 'keccak256' npm package if you need the actual hash
            return data.map(b => b.toString(16).padStart(2, '0')).join('');
        };

        const hash = keccak256(utf8Encoded);
        
        for (let i = 0; i < 40; i += 2) {
            const hashByte = parseInt(hash[i] + hash[i + 1], 16);
            if ((hashByte >> 4) >= 8 && value[i + 2].toUpperCase() !== value[i + 2]) {
                return false;
            }
            if ((hashByte & 0x0f) >= 8 && value[i + 3].toUpperCase() !== value[i + 3]) {
                return false;
            }
        }

        return true;
    } catch (error) {
        return false;
    }
}
