export interface ContractEvent<T = any> {
    id: string;
    contractId: string;
    type: string;
    timestamp: string;
    data: T;
}

export interface ContractEventFilter {
    contractId: string;
    topics?: string[];
    startLedger?: number;
}

export interface UseContractEventsOptions {
    contractId: string;
    topics?: string[];
    autoStart?: boolean;
    pollInterval?: number;
}

export interface UseContractEventsResult<T = any> {
    events: ContractEvent<T>[];
    isListening: boolean;
    error: Error | null;
    start: () => void;
    stop: () => void;
    clear: () => void;
}
