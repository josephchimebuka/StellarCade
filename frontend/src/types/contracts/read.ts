export interface ContractReadOptions {
    pollingInterval?: number;
    enabled?: boolean;
}

export interface ContractReadResult<T = any> {
    data: T | null;
    loading: boolean;
    error: Error | null;
    read: (method: string, params?: any[], options?: ContractReadOptions) => Promise<T | null>;
    refetch: () => Promise<void>;
    clear: () => void;
}
