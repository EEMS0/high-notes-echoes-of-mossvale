/*
 * MossFPInteraction — first-person targeting, reticle and prompts.
 *
 * The 2D game picks interaction targets purely by proximity
 * (nearestInteractable). At eye level that is not enough: standing between two
 * NPCs would pick whichever is a pixel closer regardless of where you are
 * looking, and you could talk through a tree.
 *
 * So proximity remains the candidate source — keeping the game's tuned ranges —
 * and this module adds the two things first person needs: a view cone and a
 * line-of-sight test against the same obstacle circles the collision uses.
 */
const CONE_COS = Math.cos(0.62);   /* ~35 degrees off-centre stays targetable */
const LABELS = {
  npc: 'Speak to',
  shrine: 'Recover note',
  portal: 'Travel to',
  'world-event': 'Investigate'
};

function inputLabel(action) {
  if (window.MossInput && typeof window.MossInput.label === 'function') {
    return window.MossInput.label(action);
  }
  return 'E';
}

/*
 * Segment-versus-circle test. Returns true when the straight line from the
 * player to the target passes through a solid obstacle.
 */
export function lineBlocked(fromX, fromY, toX, toY, circles, padding) {
  var dx = toX - fromX;
  var dy = toY - fromY;
  var lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.0001) return false;
  for (var i = 0; i < circles.length; i++) {
    var circle = circles[i];
    var radius = (circle.r || 0) - (padding || 0);
    if (radius <= 0) continue;
    /* Closest point on the segment to the circle centre. */
    var t = ((circle.x - fromX) * dx + (circle.y - fromY) * dy) / lengthSq;
    if (t <= 0 || t >= 1) continue;
    var px = fromX + dx * t;
    var py = fromY + dy * t;
    var ox = px - circle.x;
    var oy = py - circle.y;
    if (ox * ox + oy * oy < radius * radius) return true;
  }
  return false;
}

/* Is the target within the view cone? forward and offset are 2D unit-ish vectors. */
export function withinCone(forwardX, forwardY, offsetX, offsetY, cosLimit) {
  var length = Math.hypot(offsetX, offsetY);
  if (length <= 0.0001) return true;
  var dot = (forwardX * offsetX + forwardY * offsetY) / length;
  return dot >= cosLimit;
}

export class MossFPInteraction {
  constructor() {
    this.target = null;
    this.reticle = null;
    this.prompt = null;
    this.lastPromptKey = '';
  }

  ensureNodes() {
    if (this.reticle && this.reticle.isConnected) return;
    var shell = document.getElementById('gameShell') || document.body;

    this.reticle = document.createElement('div');
    this.reticle.className = 'fp-reticle';
    this.reticle.setAttribute('aria-hidden', 'true');
    shell.appendChild(this.reticle);

    this.prompt = document.createElement('div');
    this.prompt.className = 'fp-prompt';
    this.prompt.setAttribute('role', 'status');
    this.prompt.setAttribute('aria-live', 'polite');
    shell.appendChild(this.prompt);
  }

  clear() {
    this.target = null;
    if (this.reticle) this.reticle.classList.remove('is-active', 'is-visible');
    if (this.prompt) this.prompt.classList.remove('is-visible');
    this.lastPromptKey = '';
  }

  describe() {
    if (!this.target) return null;
    return { type: this.target.type, distance: Math.round(this.target.d) };
  }

  targetName(target) {
    if (!target) return '';
    if (target.type === 'npc') {
      var npc = target.item.npc || target.item;
      return npc.name || 'someone';
    }
    if (target.type === 'portal') return target.item.name || 'the next stage';
    return '';
  }

  update(api, yaw) {
    this.ensureNodes();
    var settings = (window.MossInput && window.MossInput.settings) || {};
    if (settings.reticle === false) {
      this.clear();
      return;
    }

    var player = api.getPlayer();
    var candidate = api.nearestInteractable();
    var accepted = null;

    if (candidate) {
      /* Camera forward in the 2D game's axes: yaw 0 looks along -y. */
      var forwardX = -Math.sin(yaw);
      var forwardY = -Math.cos(yaw);
      var offsetX = candidate.item.x - player.x;
      var offsetY = candidate.item.y - player.y;
      if (withinCone(forwardX, forwardY, offsetX, offsetY, CONE_COS)) {
        var obstacles = api.getEntities().obstacles || [];
        /* Padding keeps a target hugging a trunk from being falsely rejected. */
        if (!lineBlocked(player.x, player.y, candidate.item.x, candidate.item.y, obstacles, 6)) {
          accepted = candidate;
        }
      }
    }

    this.target = accepted;
    this.reticle.classList.add('is-visible');
    this.reticle.classList.toggle('is-active', !!accepted);

    if (!accepted) {
      this.prompt.classList.remove('is-visible');
      this.lastPromptKey = '';
      return;
    }

    var verb = LABELS[accepted.type] || 'Interact';
    var name = this.targetName(accepted);
    var button = inputLabel('interact');
    var key = button + '|' + verb + '|' + name;
    /* Only touch the DOM when the visible text would actually change. */
    if (key !== this.lastPromptKey) {
      this.lastPromptKey = key;
      this.prompt.innerHTML = '<span class="cprompt" data-btn="' + button + '">' + button +
        '</span><span class="fp-prompt-text">' + verb + (name ? ' ' + name : '') + '</span>';
    }
    this.prompt.classList.add('is-visible');
  }
}
