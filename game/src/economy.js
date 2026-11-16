// Match money. Start $800. Kill $300, round win $900, round loss $400.
// spend() returns false when the player cannot afford it (no partial spend).
// The arsenal's buy() only adds to `owned`; price check + spend live here,
// so a purchase is: if (economy.spend(def.price)) arsenal.buy(name).
export function createEconomy() {
  const START_MONEY = 800;
  const economy = {
    money: START_MONEY,
    killReward: 300,
    roundWin: 900,
    roundLoss: 400,
    add(n) {
      economy.money += n;
      return economy.money;
    },
    spend(n) {
      if (n < 0 || economy.money < n) return false;
      economy.money -= n;
      return true;
    },
    reset() {
      economy.money = START_MONEY;
    },
  };
  return economy;
}
