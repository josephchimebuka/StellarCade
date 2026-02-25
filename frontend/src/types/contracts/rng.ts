export enum RngRequestStatus {
    Pending = 'Pending',
    Fulfilled = 'Fulfilled',
    Failed = 'Failed',
}

export interface RngRequestOptions {
    min?: number;
    max?: number;
}

export interface RngRequestResult {
    requestId: string;
    status: RngRequestStatus;
    result?: number;
    requestedAt: number;
    fulfilledAt?: number;
}
