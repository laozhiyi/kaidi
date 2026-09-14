'use strict';
const BASE_SCORE = 80;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
function points(score) {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('评分必须是1至5星');
  return (score - 3) * 2;
}
function summarize(reviewCounts, adminCounts) {
  const group = counts => {
    const distribution = [1, 2, 3, 4, 5].map(score => ({ score, count: Number(counts[score - 1]) || 0, points: points(score) }));
    const count = distribution.reduce((total, row) => total + row.count, 0);
    return { count, distribution, points: distribution.reduce((total, row) => total + row.count * row.points, 0),
      average: count ? Number((distribution.reduce((total, row) => total + row.count * row.score, 0) / count).toFixed(1)) : null };
  };
  const reviews = group(reviewCounts), admin = group(adminCounts);
  const rawScore = BASE_SCORE + reviews.points + admin.points;
  return { baseScore: BASE_SCORE, minScore: MIN_SCORE, maxScore: MAX_SCORE, rawScore,
    score: Math.max(MIN_SCORE, Math.min(MAX_SCORE, rawScore)), reviews, admin,
    rules: [1, 2, 3, 4, 5].map(score => ({ score, points: points(score) })) };
}
module.exports = { BASE_SCORE, MIN_SCORE, MAX_SCORE, points, summarize };
