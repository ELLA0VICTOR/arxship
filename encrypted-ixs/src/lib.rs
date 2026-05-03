use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    const BOARD_CELLS: usize = 25;
    const SHIPS_PER_PLAYER: u8 = 3;

    #[derive(Copy, Clone)]
    pub struct MatchState {
        pub p1_ships: u64,
        pub p2_ships: u64,
        pub p1_hits: u64,
        pub p2_hits: u64,
    }

    fn count_cells(mask: u64) -> u8 {
        let mut count = 0u8;
        let mut bit_value = 1u64;

        for _ in 0..BOARD_CELLS {
            if (mask / bit_value) % 2u64 == 1u64 {
                count += 1;
            }
            bit_value *= 2u64;
        }

        count
    }

    fn cell_is_set(mask: u64, cell: u8) -> bool {
        let mut selected = false;
        let mut bit_value = 1u64;

        for i in 0..BOARD_CELLS {
            if cell == i as u8 {
                selected = ((mask / bit_value) % 2u64) == 1u64;
            }
            bit_value *= 2u64;
        }

        selected
    }

    fn is_valid_fleet(mask: u64) -> bool {
        let board_limit = 33_554_432u64; // 2^25, one bit per 5x5 board cell.
        mask < board_limit && count_cells(mask) == SHIPS_PER_PLAYER
    }

    #[instruction]
    pub fn init_match_state() -> Enc<Mxe, MatchState> {
        Mxe::get().from_arcis(MatchState {
            p1_ships: 0,
            p2_ships: 0,
            p1_hits: 0,
            p2_hits: 0,
        })
    }

    #[instruction]
    pub fn submit_fleet(
        fleet: Enc<Shared, u64>,
        state: Enc<Mxe, MatchState>,
        player_index: u8,
    ) -> (Enc<Mxe, MatchState>, bool) {
        let fleet_mask = fleet.to_arcis();
        let mut next_state = state.to_arcis();
        let accepted = is_valid_fleet(fleet_mask) && (player_index == 1u8 || player_index == 2u8);

        if accepted && player_index == 1u8 {
            next_state.p1_ships = fleet_mask;
            next_state.p1_hits = 0;
        }

        if accepted && player_index == 2u8 {
            next_state.p2_ships = fleet_mask;
            next_state.p2_hits = 0;
        }

        (state.owner.from_arcis(next_state), accepted.reveal())
    }

    #[instruction]
    pub fn fire_shot(
        state: Enc<Mxe, MatchState>,
        shooter_index: u8,
        shot_cell: u8,
        shot_mask: u64,
    ) -> (Enc<Mxe, MatchState>, bool, u8) {
        let mut next_state = state.to_arcis();
        let target_ships = if shooter_index == 1u8 {
            next_state.p2_ships
        } else {
            next_state.p1_ships
        };
        let hit = cell_is_set(target_ships, shot_cell);

        if hit && shooter_index == 1u8 {
            next_state.p2_hits += shot_mask;
        }

        if hit && shooter_index == 2u8 {
            next_state.p1_hits += shot_mask;
        }

        let p1_wins = count_cells(next_state.p2_hits) >= SHIPS_PER_PLAYER;
        let p2_wins = count_cells(next_state.p1_hits) >= SHIPS_PER_PLAYER;
        let winner = if p1_wins {
            1u8
        } else if p2_wins {
            2u8
        } else {
            0u8
        };

        (
            state.owner.from_arcis(next_state),
            hit.reveal(),
            winner.reveal(),
        )
    }
}
