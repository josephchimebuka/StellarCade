export interface PrizePoolState {
    balance: string;
    totalReserved: string;
    admin: string;
}

export interface ReservePayload {
    gameId: string;
    amount: string;
}

export interface PayoutPayload {
    gameId: string;
    playerAddress: string;
    amount: string;
}
