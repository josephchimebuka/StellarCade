export enum CoinFlipSide {
    Heads = 0,
    Tails = 1,
}

export enum CoinFlipGameState {
    Placed = 'Placed',
    Pending = 'Pending',
    Resolved = 'Resolved',
}

export interface CoinFlipGame {
    id: string;
    wager: string;
    side: CoinFlipSide;
    status: CoinFlipGameState;
    winner?: string;
    settledAt?: number;
}
