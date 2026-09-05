/* Deterministic, bounded label placement shared by the atlas and rehearsal map. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MossMapLabels = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function overlaps(a, b) {
    return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
  }
  function layout(labels, width, height, obstacles) {
    var occupied = (obstacles || []).slice(), placed = [];
    labels.map(function (label, index) { return { label: label, index: index }; })
      .sort(function (a, b) { return (b.label.priority || 0) - (a.label.priority || 0) || a.index - b.index; })
      .forEach(function (entry) {
        var label = entry.label, w = label.w, h = label.h || 13, candidates = [];
        if (![label.x, label.y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
        for (var ring = 0; ring < 5; ring++) {
          var gap = 10 + ring * 15;
          candidates.push([label.x - w / 2, label.y - gap - h], [label.x - w / 2, label.y + gap],
            [label.x + gap, label.y - h / 2], [label.x - gap - w, label.y - h / 2],
            [label.x + gap, label.y - gap - h], [label.x - gap - w, label.y + gap],
            [label.x + gap, label.y + gap], [label.x - gap - w, label.y - gap - h]);
        }
        for (var i = 0; i < candidates.length; i++) {
          var box = { x: candidates[i][0], y: candidates[i][1], w: w, h: h };
          if (box.x < 4 || box.y < 4 || box.x + w > width - 4 || box.y + h > height - 4) continue;
          if (occupied.some(function (other) { return overlaps(box, other); })) continue;
          occupied.push(box);
          placed.push({ text: label.text, color: label.color, anchorX: label.x, anchorY: label.y,
            x: box.x, y: box.y, w: w, h: h });
          break;
        }
        // Crowded optional labels may be hidden; their map icons always remain visible.
      });
    return placed;
  }
  return Object.freeze({ layout: layout, overlaps: overlaps });
});
