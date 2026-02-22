worker/package.json
// worker/aggregator.js (use in place of scan.js)
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import axios from 'axios';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }

function computeScores({ marketScore, onchain, dev, social, tokenomics }) {
  const onchainScore = onchain?.overall ?? 50;
  const devScore = dev?.overall ?? 50;
  const socialScore = social?.overall ?? 50;
  const tokenomicsScore = tokenomics?.overall ?? 50;

  const composite = Math.round(0.4 * marketScore + 0.2 * onchainScore + 0.15 * devScore + 0.15 * socialScore + 0.1 * tokenomicsScore);

  const daaScore = onchain?.daa_score ?? 50;
  const feesInTokenScore = onchain?.fees_in_token ?? 50;
  const burnRateScore = tokenomics?.burn_rate ?? 50;
  const liquidityScore = onchain?.liquidity ?? 50;
  const vestingRiskScore = tokenomics?.vesting_risk ?? 25;

  const rocket = Math.round(
    0.30 * daaScore +
    0.25 * feesInTokenScore +
    0.20 * burnRateScore +
    0.15 * liquidityScore +
    0.10 * (100 - vestingRiskScore)
  );

  const combined = Math.round(0.55 * composite + 0.45 * rocket);

  return {
    marketScore, onchainScore, devScore, socialScore, tokenomicsScore,
    daaScore, feesInTokenScore, burnRateScore, liquidityScore, vestingRiskScore,
    composite, rocket, combined
  };
}

async function fetchOnchainProxy(coingeckoId) {
  try {
    const resp = await axios.get(`https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart`, {
      params: { vs_currency: 'usd', days: 30 }
    });

    const prices = resp.data.prices;
    const vols = resp.data.total_volumes;
    const len = prices.length;
    if (len < 8) return null;

    const priceNow = prices[len - 1][1];
    const price7 = prices[Math.max(0, len - 7)][1];
    const pct7 = ((priceNow - price7) / price7) * 100;

    const volNow = vols[len - 1][1];
    const vol7avg = vols.slice(-7).reduce((s, i) => s + i[1], 0) / 7;
    const volPct = ((volNow - vol7avg) / Math.max(1, vol7avg)) * 100;

    const daa_score = clamp(50 + volPct / 2);
    const fees_in_token = clamp(50 + volPct / 3);
    const liquidity = clamp(50 - Math.abs(pct7) / 2);

    const overall = Math.round(0.5 * daa_score + 0.3 * fees_in_token + 0.2 * liquidity);
    return { overall, daa_score, fees_in_token, liquidity, pct7, volPct };
  } catch (e) {
    console.error('onchain proxy error', coingeckoId, e.message);
    return null;
  }
}

async function fetchSocialProxy(coingeckoId) {
  try {
    const r = await axios.get(`https://api.coingecko.com/api/v3/coins/${coingeckoId}`);
    const c = r.data.community_data || {};
    const tw = c.twitter_followers || 0;
    const rr = c.reddit_subscribers || 0;
    const score = clamp(Math.log10(Math.max(1, tw + rr)) * 20);
    return { overall: Math.round(score), tw, rr };
  } catch {
    return { overall: 50 };
  }
}

async function runOnce() {
  const coins = (await pool.query('SELECT id, coingecko_id FROM coins')).rows;

  for (const c of coins) {
    try {
      const marketResp = await axios.get(`https://api.coingecko.com/api/v3/coins/${c.coingecko_id}/market_chart`, {
        params: { vs_currency: 'usd', days: 30 }
      });

      const prices = marketResp.data.prices;
      const len = prices.length;
      if (len < 8) continue;

      const priceNow = prices[len - 1][1];
      const price7 = prices[Math.max(0, len - 7)][1];
      const pct7 = ((priceNow - price7) / price7) * 100;
      const marketScore = clamp(50 + pct7);

      const onchain = await fetchOnchainProxy(c.coingecko_id);
      const dev = { overall: 50 };
      const social = await fetchSocialProxy(c.coingecko_id);
      const tokenomics = { overall: 50, burn_rate: 50, vesting_risk: 25 };

      const scores = computeScores({ marketScore, onchain, dev, social, tokenomics });

      await pool.query(`
        INSERT INTO signals (
          coin_id, snapshot_ts,
          market_score, onchain_score, dev_score, social_score, tokenomics_score,
          daa_score, fees_in_token_score, burn_rate_score, liquidity_score, vesting_risk_score,
          composite_score, rocket_score, combined_score, raw
        )
        VALUES (
          $1, now(),
          $2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,
          $12,$13,$14,$15
        )
      `, [
        c.id,
        scores.marketScore, scores.onchainScore, scores.devScore, scores.socialScore, scores.tokenomicsScore,
        scores.daaScore, scores.feesInTokenScore, scores.burnRateScore, scores.liquidityScore, scores.vestingRiskScore,
        scores.composite, scores.rocket, scores.combined,
        JSON.stringify({ onchain, social, pct7 })
      ]);

    } catch (e) {
      console.error('Worker coin error:', c.coingecko_id, e.message);
    }
  }

  console.log('Worker pass complete:', new Date().toISOString());
  process.exit(0);
}

runOnce().catch(e => { console.error(e); process.exit(1); });
