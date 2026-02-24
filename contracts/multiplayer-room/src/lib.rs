#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, Vec,
};

pub const MIN_PLAYERS_TO_START: u32 = 2;
pub const MAX_PLAYERS_PER_ROOM: u32 = 100;
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidRoomId = 4,
    InvalidConfigHash = 5,
    RoomAlreadyExists = 6,
    RoomNotFound = 7,
    InvalidState = 8,
    DuplicatePlayer = 9,
    RoomFull = 10,
    NotEnoughPlayers = 11,
    ContractPaused = 12,
    Overflow = 13,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RoomStatus {
    Open = 0,
    InMatch = 1,
    Closed = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoomData {
    pub room_id: u64,
    pub config_hash: BytesN<32>,
    pub status: RoomStatus,
    pub player_count: u32,
    pub created_by: Address,
}

#[contracttype]
pub enum DataKey {
    Admin,
    FeeContract,
    Paused,
    Room(u64),
    RoomPlayers(u64),
    PlayerInRoom(u64, Address),
}

#[contractevent]
pub struct Initialized {
    #[topic]
    pub admin: Address,
    pub fee_contract: Address,
}

#[contractevent]
pub struct RoomCreated {
    #[topic]
    pub room_id: u64,
    pub config_hash: BytesN<32>,
    pub created_by: Address,
}

#[contractevent]
pub struct PlayerJoined {
    #[topic]
    pub room_id: u64,
    #[topic]
    pub player: Address,
    pub player_count: u32,
}

#[contractevent]
pub struct MatchStarted {
    #[topic]
    pub room_id: u64,
    pub player_count: u32,
}

#[contractevent]
pub struct RoomClosed {
    #[topic]
    pub room_id: u64,
    pub final_player_count: u32,
}

#[contract]
pub struct MultiplayerRoom;

#[contractimpl]
impl MultiplayerRoom {
    pub fn init(env: Env, admin: Address, fee_contract: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::FeeContract, &fee_contract);
        env.storage().instance().set(&DataKey::Paused, &false);

        Initialized {
            admin,
            fee_contract,
        }
        .publish(&env);

        Ok(())
    }

    pub fn create_room(env: Env, room_id: u64, config_hash: BytesN<32>) -> Result<(), Error> {
        require_initialized(&env)?;
        ensure_not_paused(&env)?;
        require_admin_auth(&env)?;

        if room_id == 0 {
            return Err(Error::InvalidRoomId);
        }

        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        if config_hash == zero_hash {
            return Err(Error::InvalidConfigHash);
        }

        let room_key = DataKey::Room(room_id);
        if env.storage().persistent().has(&room_key) {
            return Err(Error::RoomAlreadyExists);
        }

        let admin = get_admin(&env)?;
        let room = RoomData {
            room_id,
            config_hash: config_hash.clone(),
            status: RoomStatus::Open,
            player_count: 0,
            created_by: admin.clone(),
        };

        set_persistent(&env, room_key, &room);
        set_persistent(
            &env,
            DataKey::RoomPlayers(room_id),
            &Vec::<Address>::new(&env),
        );

        RoomCreated {
            room_id,
            config_hash,
            created_by: admin,
        }
        .publish(&env);

        Ok(())
    }

    pub fn join_room(env: Env, room_id: u64, player: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        ensure_not_paused(&env)?;

        if room_id == 0 {
            return Err(Error::InvalidRoomId);
        }

        player.require_auth();

        let mut room = get_room(&env, room_id)?;
        if room.status != RoomStatus::Open {
            return Err(Error::InvalidState);
        }

        let member_key = DataKey::PlayerInRoom(room_id, player.clone());
        if env.storage().persistent().has(&member_key) {
            return Err(Error::DuplicatePlayer);
        }

        if room.player_count >= MAX_PLAYERS_PER_ROOM {
            return Err(Error::RoomFull);
        }

        let mut players: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::RoomPlayers(room_id))
            .unwrap_or(Vec::new(&env));
        players.push_back(player.clone());
        set_persistent(&env, DataKey::RoomPlayers(room_id), &players);

        env.storage().persistent().set(&member_key, &true);
        extend_persistent_ttl(&env, &member_key);

        room.player_count = room.player_count.checked_add(1).ok_or(Error::Overflow)?;
        set_persistent(&env, DataKey::Room(room_id), &room);

        PlayerJoined {
            room_id,
            player,
            player_count: room.player_count,
        }
        .publish(&env);

        Ok(())
    }

    pub fn start_match(env: Env, room_id: u64) -> Result<(), Error> {
        require_initialized(&env)?;
        ensure_not_paused(&env)?;
        require_admin_auth(&env)?;

        if room_id == 0 {
            return Err(Error::InvalidRoomId);
        }

        let mut room = get_room(&env, room_id)?;
        if room.status != RoomStatus::Open {
            return Err(Error::InvalidState);
        }

        if room.player_count < MIN_PLAYERS_TO_START {
            return Err(Error::NotEnoughPlayers);
        }

        room.status = RoomStatus::InMatch;
        set_persistent(&env, DataKey::Room(room_id), &room);

        MatchStarted {
            room_id,
            player_count: room.player_count,
        }
        .publish(&env);

        Ok(())
    }

    pub fn close_room(env: Env, room_id: u64) -> Result<(), Error> {
        require_initialized(&env)?;
        ensure_not_paused(&env)?;
        require_admin_auth(&env)?;

        if room_id == 0 {
            return Err(Error::InvalidRoomId);
        }

        let mut room = get_room(&env, room_id)?;
        if room.status == RoomStatus::Closed {
            return Err(Error::InvalidState);
        }

        room.status = RoomStatus::Closed;
        set_persistent(&env, DataKey::Room(room_id), &room);

        RoomClosed {
            room_id,
            final_player_count: room.player_count,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_room(env: Env, room_id: u64) -> Result<RoomData, Error> {
        require_initialized(&env)?;
        get_room(&env, room_id)
    }

    pub fn get_players(env: Env, room_id: u64) -> Result<Vec<Address>, Error> {
        require_initialized(&env)?;
        if room_id == 0 {
            return Err(Error::InvalidRoomId);
        }

        if !env.storage().persistent().has(&DataKey::Room(room_id)) {
            return Err(Error::RoomNotFound);
        }

        let players = env
            .storage()
            .persistent()
            .get(&DataKey::RoomPlayers(room_id))
            .unwrap_or(Vec::new(&env));

        Ok(players)
    }

    pub fn get_fee_contract(env: Env) -> Result<Address, Error> {
        require_initialized(&env)?;

        env.storage()
            .instance()
            .get(&DataKey::FeeContract)
            .ok_or(Error::NotInitialized)
    }
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }

    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    let paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false);

    if paused {
        return Err(Error::ContractPaused);
    }

    Ok(())
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn require_admin_auth(env: &Env) -> Result<(), Error> {
    let admin = get_admin(env)?;
    admin.require_auth();
    Ok(())
}

fn get_room(env: &Env, room_id: u64) -> Result<RoomData, Error> {
    if room_id == 0 {
        return Err(Error::InvalidRoomId);
    }

    env.storage()
        .persistent()
        .get(&DataKey::Room(room_id))
        .ok_or(Error::RoomNotFound)
}

fn set_persistent<T>(env: &Env, key: DataKey, value: &T)
where
    T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    env.storage().persistent().set(&key, value);
    extend_persistent_ttl(env, &key);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _},
        vec, Address, Env,
    };

    fn setup(env: &Env) -> (MultiplayerRoomClient<'_>, Address, Address) {
        let admin = Address::generate(env);
        let fee_contract = Address::generate(env);
        let contract_id = env.register(MultiplayerRoom, ());
        let client = MultiplayerRoomClient::new(env, &contract_id);

        client.mock_all_auths().init(&admin, &fee_contract);

        (client, admin, contract_id)
    }

    #[test]
    fn test_init_and_get_fee_contract() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let fee_contract = Address::generate(&env);
        let contract_id = env.register(MultiplayerRoom, ());
        let client = MultiplayerRoomClient::new(&env, &contract_id);

        client.mock_all_auths().init(&admin, &fee_contract);

        let stored = client.get_fee_contract();
        assert_eq!(stored, fee_contract);

        let result = client.try_init(&admin, &fee_contract);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_join_start_close_happy_path() {
        let env = Env::default();
        let (client, _admin, _contract_id) = setup(&env);

        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        let room_id = 7u64;
        let hash = BytesN::from_array(&env, &[7u8; 32]);

        client.mock_all_auths().create_room(&room_id, &hash);
        client.mock_all_auths().join_room(&room_id, &p1);
        client.mock_all_auths().join_room(&room_id, &p2);
        client.mock_all_auths().start_match(&room_id);
        client.mock_all_auths().close_room(&room_id);

        let room = client.get_room(&room_id);
        assert_eq!(room.status, RoomStatus::Closed);
        assert_eq!(room.player_count, 2);

        let players = client.get_players(&room_id);
        assert_eq!(players, vec![&env, p1, p2]);

        let _events = env.events().all();
    }

    #[test]
    fn test_unauthorized_privileged_methods_fail() {
        let env = Env::default();
        let (client, _admin, _) = setup(&env);

        let room_id = 9u64;
        let hash = BytesN::from_array(&env, &[9u8; 32]);

        let create_result = client.try_create_room(&room_id, &hash);
        assert!(create_result.is_err());

        client.mock_all_auths().create_room(&room_id, &hash);

        let start_result = client.try_start_match(&room_id);
        assert!(start_result.is_err());

        let close_result = client.try_close_room(&room_id);
        assert!(close_result.is_err());
    }

    #[test]
    fn test_duplicate_join_and_duplicate_create_fail() {
        let env = Env::default();
        let (client, _, _) = setup(&env);

        let room_id = 12u64;
        let hash = BytesN::from_array(&env, &[12u8; 32]);
        let player = Address::generate(&env);

        client.mock_all_auths().create_room(&room_id, &hash);
        client.mock_all_auths().join_room(&room_id, &player);

        let dup_join = client.mock_all_auths().try_join_room(&room_id, &player);
        assert_eq!(dup_join, Err(Ok(Error::DuplicatePlayer)));

        let dup_room = client.mock_all_auths().try_create_room(&room_id, &hash);
        assert_eq!(dup_room, Err(Ok(Error::RoomAlreadyExists)));
    }

    #[test]
    fn test_invalid_state_transitions_fail() {
        let env = Env::default();
        let (client, _, _) = setup(&env);

        let room_id = 13u64;
        let hash = BytesN::from_array(&env, &[13u8; 32]);
        let player = Address::generate(&env);

        client.mock_all_auths().create_room(&room_id, &hash);

        let early_start = client.try_start_match(&room_id);
        assert!(early_start.is_err());

        client.mock_all_auths().join_room(&room_id, &player);
        let second_player = Address::generate(&env);
        client.mock_all_auths().join_room(&room_id, &second_player);

        client.mock_all_auths().start_match(&room_id);

        let join_after_start = client.try_join_room(&room_id, &Address::generate(&env));
        assert!(join_after_start.is_err());

        client.mock_all_auths().close_room(&room_id);

        let close_again = client.try_close_room(&room_id);
        assert!(close_again.is_err());
    }

    #[test]
    fn test_invalid_room_id_rejected() {
        let env = Env::default();
        let (client, _, _) = setup(&env);

        let valid_hash = BytesN::from_array(&env, &[1u8; 32]);
        let invalid_room_result = client.mock_all_auths().try_create_room(&0u64, &valid_hash);
        assert_eq!(invalid_room_result, Err(Ok(Error::InvalidRoomId)));

        let bad_join = client.try_join_room(&0u64, &Address::generate(&env));
        assert_eq!(bad_join, Err(Ok(Error::InvalidRoomId)));
    }

    #[test]
    fn test_invalid_config_hash_rejected() {
        let env = Env::default();
        let (client, _, _) = setup(&env);

        let room_id = 100u64;
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        let invalid_hash_result = client
            .mock_all_auths()
            .try_create_room(&room_id, &zero_hash);
        assert_eq!(invalid_hash_result, Err(Ok(Error::InvalidConfigHash)));
    }

    #[test]
    fn test_paused_guard_blocks_methods() {
        let env = Env::default();
        let (client, _, contract_id) = setup(&env);

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Paused, &true);
        });

        let room_id = 77u64;
        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let player = Address::generate(&env);

        assert!(client.try_create_room(&room_id, &hash).is_err());
        assert!(client.try_join_room(&room_id, &player).is_err());
        assert!(client.try_start_match(&room_id).is_err());
        assert!(client.try_close_room(&room_id).is_err());
    }
}
