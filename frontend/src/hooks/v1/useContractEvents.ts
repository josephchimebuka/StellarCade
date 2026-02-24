import { useState, useEffect, useCallback, useRef } from 'react';
import { UseContractEventsOptions, UseContractEventsResult, ContractEvent } from '../../types/contracts/events';

/**
 * Hook to reactively subscribe to and fetch events from a Soroban contract.
 * @param options configuration options including contractId and topics
 * @returns State and controls for the event subscription
 */
export function useContractEvents<T = any>({
    contractId,
    topics = [],
    autoStart = true,
    pollInterval = 5000,
}: UseContractEventsOptions): UseContractEventsResult<T> {
    const [events, setEvents] = useState<ContractEvent<T>[]>([]);
    const [isListening, setIsListening] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    // Use refs to keep track of mutable state for polling without triggering re-renders
    const isListeningRef = useRef(false);
    const seenEventIdsRef = useRef<Set<string>>(new Set());
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const start = useCallback(() => {
        if (!contractId) {
            setError(new Error('Contract ID is required to listen for events'));
            return;
        }
        setError(null);
        setIsListening(true);
        isListeningRef.current = true;
    }, [contractId]);

    const stop = useCallback(() => {
        setIsListening(false);
        isListeningRef.current = false;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const clear = useCallback(() => {
        setEvents([]);
        seenEventIdsRef.current.clear();
        setError(null);
    }, []);

    // Note: in a real application this mock implementation would be replaced
    // with an actual rpc call using the @stellar/stellar-sdk or Soroban RPC client
    // Example: rpcServer.getEvents({ startLedger, filters: [{ type: 'contract', contractIds: [contractId], topics }] })

    const fetchEvents = useCallback(async () => {
        if (!isListeningRef.current) return;

        try {
            // Mocked fetch layer for events. Replace with actual deterministic fetch when RPC is injected.
            // This enforces the expected standard execution sequence block logic.
            const mockResult: ContractEvent<T>[] = []; // Simulate no events or mocked results.

            if (mockResult.length > 0) {
                setEvents((prev) => {
                    const newEvents = mockResult.filter((e) => !seenEventIdsRef.current.has(e.id));
                    if (newEvents.length === 0) return prev;

                    newEvents.forEach((e) => seenEventIdsRef.current.add(e.id));
                    // return most recent first
                    return [...newEvents, ...prev].sort((a, b) =>
                        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                    );
                });
            }
        } catch (err: any) {
            if (isListeningRef.current) {
                setError(new Error(err.message || 'Failed to fetch contract events'));
                stop(); // Optional: stop listening on error or implement retry strategies
            }
        } finally {
            if (isListeningRef.current) {
                timerRef.current = setTimeout(fetchEvents, pollInterval);
            }
        }
    }, [pollInterval, stop]);

    useEffect(() => {
        if (autoStart) {
            start();
        }
        return () => {
            stop();
        };
    }, [autoStart, start, stop]);

    useEffect(() => {
        if (isListening) {
            fetchEvents();
        }
    }, [isListening, fetchEvents]);

    return {
        events,
        isListening,
        error,
        start,
        stop,
        clear,
    };
}
