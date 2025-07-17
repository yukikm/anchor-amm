use crate::error::AmmError;
use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};
use constant_product_curve::{ConstantProduct, LiquidityPair};

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump
    )]
    pub config: Account<'info, Config>,
}

impl<'info> Update<'info> {
    pub fn lock(&mut self) -> Result<()> {
        require!(
            self.user.key() == self.config.authority.unwrap(),
            AmmError::InvalidAuthority
        );
        self.config.locked = true;
        Ok(())
    }
    pub fn unlock(&mut self) -> Result<()> {
        require!(
            self.user.key() == self.config.authority.unwrap(),
            AmmError::InvalidAuthority
        );
        self.config.locked = false;
        Ok(())
    }
}
