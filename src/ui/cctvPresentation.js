import { createCctvVideoSurface } from './cctvVideo.js';
import {
  DES_MOINES_CITY_ID,
  cctvCatalogCounts,
  cctvFeedStatus,
  cctvOptionLabel,
  cctvRoutes,
  filterCctvCameras,
  normalizeCctvRoute,
} from './cctvBrowse.js';
export function _calBadgeLabel(badge) {
  switch (badge) {
    case 'calibrated':
      return 'CALIBRATED';
    case 'curated':
      return 'CURATED';
    case 'raw-prior':
      return 'RAW PRIOR';
    default:
      return '--';
  }
}

export function _renderCctvState(state) {
  if (this.destroyed) return;
  if (
    !state?.enabled ||
    !this.actions.isEnabled() ||
    state?.activeCameraId !== this._cctvState?.activeCameraId
  ) {
    this._calibrationEdit?.(false);
  }
  this._cctvState = state || null;
  const cameras = state?.cameras || [];
  const enabled = !!state?.enabled && !!this.actions.isEnabled();
  const activeId = state?.activeCameraId || '';
  const activeCamera = state?.activeCamera || null;
  if (activeId !== this._cctvPlaybackCameraId) {
    this._cctvPlaybackCameraId = activeId;
    this._cctvPlaybackState = activeCamera?.playbackState || '';
  } else if (activeCamera?.playbackState === 'fallback') {
    this._cctvPlaybackState = 'fallback';
  }

  // Auto-expand the panel when the active camera CHANGES to a new non-null
  // id while the layer is enabled. Covers click-on-globe, panel controls,
  // and voice (selectCamera/cycleCamera/focusNearest all notify through
  // this subscription). The last-seen guard keeps routine notifications
  // from re-expanding a panel the user deliberately collapsed, and timed
  // auto-hop transitions only expand on the first activation so the panel
  // does not pop open on every hop.
  const effectiveActiveId = enabled ? activeId || null : null;
  const isFirstActivation = this._lastSeenCctvActiveId === null;
  if (
    effectiveActiveId &&
    effectiveActiveId !== this._lastSeenCctvActiveId &&
    (!state?.autoHop || isFirstActivation)
  ) {
    this.actions.setPanelCollapsed('cctv-panel', false, {
      explicit: Boolean(state?.explicitSelection),
    });
  }
  this._lastSeenCctvActiveId = effectiveActiveId;

  this._updateCctvSyncChip(state?.loading, enabled);

  if (this._cctvEnableBtn) {
    this._cctvEnableBtn.classList.toggle('active', enabled);
    this._cctvEnableBtn.textContent = enabled ? 'CCTV ON' : 'CCTV OFF';
  }

  const filters = this._cctvBrowseFilters || {
    region: 'all',
    route: 'all',
    feed: 'all',
    query: '',
  };
  if (this._cctvRegionFilter) this._cctvRegionFilter.value = filters.region;
  if (filters.region !== 'des-moines') filters.route = 'all';
  const routes = cctvRoutes(cameras, DES_MOINES_CITY_ID);
  const routeSignature = routes.join('\n');
  if (this._cctvRouteFilter && this._cctvRouteSignature !== routeSignature) {
    this._cctvRouteSignature = routeSignature;
    this._cctvRouteFilter.innerHTML = '';
    for (const route of ['all', ...routes]) {
      const option = document.createElement('option');
      option.value = route;
      option.textContent = route === 'all' ? 'ALL' : route;
      this._cctvRouteFilter.appendChild(option);
    }
  }
  if (
    filters.route !== 'all' &&
    !routes.includes(normalizeCctvRoute(filters.route))
  )
    filters.route = 'all';
  if (this._cctvRouteFilter) {
    this._cctvRouteFilter.value = filters.route;
    this._cctvRouteFilter.disabled = filters.region !== 'des-moines';
  }
  if (this._cctvSearch && this._cctvSearch.value !== filters.query)
    this._cctvSearch.value = filters.query;
  for (const button of this._cctvFeedFilter?.querySelectorAll?.(
    '[data-cctv-feed]',
  ) || []) {
    const active = button.dataset.cctvFeed === filters.feed;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const filtered = filterCctvCameras(cameras, filters);
  this._cctvFilteredCameraIds = filtered.map((camera) => camera.id);
  const displayed = [...filtered];
  if (activeCamera && !displayed.some((camera) => camera.id === activeId))
    displayed.unshift(activeCamera);
  const navigationSignature =
    filters.region === 'all' &&
    filters.route === 'all' &&
    filters.feed === 'all' &&
    !filters.query
      ? 'all'
      : this._cctvFilteredCameraIds.join('\n');
  this._cctvNavigationSignature = navigationSignature;
  if (
    enabled &&
    this.actions.setParams &&
    navigationSignature !== this._cctvNavigationAppliedSignature
  ) {
    this._cctvNavigationAppliedSignature = navigationSignature;
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.actions.setParams(
        {
          navigationCameraIds:
            navigationSignature === 'all' ? null : this._cctvFilteredCameraIds,
        },
        { origin: 'user' },
      );
    });
  }
  const counts = cctvCatalogCounts(cameras);
  if (this._cctvDesMoinesSummary) {
    this._cctvDesMoinesSummary.hidden = filters.region !== 'des-moines';
    this._cctvDesMoinesSummary.textContent = `DES MOINES · ${counts.total} CAMERAS · ${counts.video} VIDEO · ${counts.image} IMAGE`;
  }

  if (this._cctvSelect) {
    const optionLabel = (camera) =>
      cctvOptionLabel(camera, { includeCity: filters.region === 'all' });
    const optionSignature = displayed
      .map((camera) => `${camera.id}\t${optionLabel(camera)}`)
      .join('\n');
    const shouldRebuild = optionSignature !== this._cctvBrowseSignature;
    if (shouldRebuild) {
      this._cctvBrowseSignature = optionSignature;
      this._cctvSelect.innerHTML = '';
      for (const camera of displayed) {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = optionLabel(camera);
        this._cctvSelect.appendChild(option);
      }
    }
    this._cctvSelect.disabled = !enabled || displayed.length === 0;
    if (
      activeId &&
      Array.from(this._cctvSelect.options).some((opt) => opt.value === activeId)
    ) {
      this._cctvSelect.value = activeId;
    } else if (!activeId) {
      this._cctvSelect.selectedIndex = -1;
    }
  }

  for (const btn of [
    this._cctvNearestBtn,
    this._cctvPrevBtn,
    this._cctvNextBtn,
  ]) {
    if (!btn) continue;
    btn.disabled = !enabled || filtered.length === 0;
  }
  if (this._cctvFocusBtn) {
    this._cctvFocusBtn.disabled = !enabled || cameras.length === 0 || !activeId;
  }

  if (this._cctvActiveInfo) this._cctvActiveInfo.hidden = !activeCamera;
  if (this._cctvActiveName)
    this._cctvActiveName.textContent = activeCamera?.name || '';
  if (this._cctvActiveDetail) {
    const route = normalizeCctvRoute(activeCamera?.route);
    this._cctvActiveDetail.textContent = activeCamera
      ? [route, activeCamera.provider].filter(Boolean).join(' · ')
      : '';
  }

  if (this._cctvCoverageBtn) {
    // Tri-state (viewshed design §3b): off → on (wireframes) → viewshed
    // (color-coded volumes). The click handler cycles; this renders.
    const mode = state?.coverageMode || (state?.showCoverage ? 'on' : 'off');
    this._cctvCoverageBtn.classList.toggle('active', mode !== 'off');
    this._cctvCoverageBtn.textContent =
      mode === 'viewshed'
        ? 'VIEWSHED ON'
        : mode === 'on'
          ? 'COVERAGE ON'
          : 'COVERAGE OFF';
    this._cctvCoverageBtn.disabled = !enabled;
  }

  if (this._cctvAutoHopBtn) {
    const autoHop = !!state?.autoHop;
    this._cctvAutoHopBtn.classList.toggle('active', autoHop);
    this._cctvAutoHopBtn.textContent = autoHop ? 'AUTO HOP ON' : 'AUTO HOP OFF';
    this._cctvAutoHopBtn.disabled = !enabled;
  }

  if (this._cctvProjectionBtn) {
    const showProjection = state?.showProjection !== false;
    this._cctvProjectionBtn.classList.toggle('active', showProjection);
    this._cctvProjectionBtn.textContent = showProjection
      ? 'PROJECTION ON'
      : 'PROJECTION OFF';
    this._cctvProjectionBtn.disabled = !enabled;
  }

  if (this._cctvQualityChip) {
    // CAL badge (cctv-v2 design §3b, amended by LOCKED §9.2 — panel-only,
    // no in-world tint): three states driven by cctv.js's deriveCalBadge,
    // no client-side scoring math. Casing is unified via _calBadgeLabel so
    // the chip and the meta line never drift onto different conventions.
    // Save-gated persistence (viewshed design §3e): unsaved live edits show
    // EDITED on top of whatever the persisted badge state is — SAVE CAL
    // promotes to CALIBRATED, RESET CAL clears.
    const badge = activeCamera?.calBadge || null;
    const dirty = !!activeCamera?.calDirty;
    this._cctvQualityChip.textContent = dirty
      ? 'CAL · EDITED (UNSAVED)'
      : `CAL · ${this._calBadgeLabel(badge)}`;
    this._cctvQualityChip.dataset.calBadge = dirty ? 'edited' : badge || '';
  }

  this._syncCctvCalReadout(enabled, activeCamera);

  if (this._cctvMeta) {
    if (activeCamera) {
      const provider =
        activeCamera.sourceLabel ||
        activeCamera.provider ||
        'Configured Source';
      const statusMsg = activeCamera.sourceMessage
        ? ` · ${activeCamera.sourceMessage}`
        : '';
      // A partner-supplied feed inside a pack names its owner here.
      const credit = activeCamera.credit ? ` · ${activeCamera.credit}` : '';
      const calBadge = activeCamera.calBadge
        ? this._calBadgeLabel(activeCamera.calBadge)
        : '';
      const projLabel = state?.showProjection !== false ? 'MONITOR' : 'OFF';
      this._cctvMeta.textContent = `${activeCamera.city} · HDG ${Math.round(activeCamera.headingDeg)}° · FOV ${Math.round(activeCamera.fovDeg)}° · RANGE ${Math.round(activeCamera.rangeM)}m · ${projLabel}${calBadge ? ` · ${calBadge}` : ''} · ${provider}${credit}${statusMsg}`;
    } else if (cameras.length > 0) {
      this._cctvMeta.textContent = enabled
        ? `${cameras.length} cameras loaded · click a camera to activate`
        : `${cameras.length} cameras loaded · enable CCTV to activate`;
    } else {
      this._cctvMeta.textContent = 'Enable CCTV to load camera intersections';
    }
  }

  const liveIntent = enabled && !!activeCamera?.isVideo;
  if (this._cctvVideo) {
    this._cctvVideo.hidden = !liveIntent;
    if (this._cctvFrame) this._cctvFrame.hidden = liveIntent;
    const visible =
      liveIntent &&
      !document.hidden &&
      !this._cctvPanel?.classList.contains('collapsed');
    if (!visible || this._cctvVideoCameraId !== activeId) {
      this._cctvVideoSurface?.stop();
      this._cctvVideoSurface = null;
    }
    this._cctvVideoCameraId = activeId;
    if (visible && !this._cctvVideoSurface) {
      this._cctvVideoSurface = createCctvVideoSurface(
        this._cctvVideo,
        () => this.cctv.getActiveVideoElement?.(),
        {
          onState: (playbackState) => {
            if (this.destroyed || this._cctvVideoCameraId !== activeId) return;
            this._cctvPlaybackState = playbackState;
            this._syncCctvFeedStatus(activeCamera);
          },
        },
      );
    }
  }

  if (this._cctvFrame && !liveIntent) {
    const nextSrc = enabled ? activeCamera?.frameUrl : null;
    const nextCameraId = enabled ? activeCamera?.id || '' : '';
    const cameraChanged = this._cctvFrame.dataset.cameraId !== nextCameraId;
    const frameLoading = this._cctvFrame.dataset.loading === 'true';
    // A same-camera refresh waits for the current image to settle. Replacing
    // src every 10 seconds can cancel a slow but healthy decode forever and
    // leave SNAPSHOT · OK beside a blank/loading preview. Camera changes are
    // immediate so navigation never waits on the prior camera's request.
    if (
      nextSrc &&
      (cameraChanged ||
        (!frameLoading && this._cctvFrame.dataset.currentSrc !== nextSrc))
    ) {
      this._queueCctvFrame(nextSrc, nextCameraId, cameraChanged);
    }
    if (!nextSrc) {
      this._clearCctvFrame();
    }
  } else if (liveIntent) {
    this._clearCctvFrame();
  }

  this._syncCctvSourceBadge(activeCamera, enabled);
  this._syncCctvFeedStatus(activeCamera);
  this._typeCctvSummary(
    state?.summary ||
      'Enable CCTV to start camera-linked intelligence summaries.',
  );
}

export function _syncCctvFeedStatus(activeCamera) {
  if (!this._cctvVideoFeedback) return;
  const status = cctvFeedStatus(activeCamera, {
    playbackState: this._cctvPlaybackState || activeCamera?.playbackState,
    imageReady: this._cctvFrameWrap?.classList.contains('has-frame'),
    imageError: this._cctvFrame?.dataset.error === 'true',
  });
  this._cctvVideoFeedback.textContent = status.label;
  this._cctvVideoFeedback.dataset.tone = status.tone;
  if (this._cctvActiveDetail && activeCamera) {
    this._cctvActiveDetail.textContent = [
      normalizeCctvRoute(activeCamera.route),
      activeCamera.provider,
      status.label,
    ]
      .filter(Boolean)
      .join(' · ');
  }
}

export function _typeCctvSummary(text) {
  if (this.destroyed || !this._cctvSummary) return;
  const nextText = String(text || '').trim() || 'No summary available.';
  if (nextText === this._lastCctvSummaryText) return;
  this._lastCctvSummaryText = nextText;

  clearInterval(this._cctvSummaryTypingTimer);
  this._cctvSummary.textContent = '';
  let idx = 0;
  this._cctvSummaryTypingTimer = setInterval(() => {
    if (this.destroyed) return;
    idx += 3;
    if (idx >= nextText.length) {
      this._cctvSummary.textContent = nextText;
      clearInterval(this._cctvSummaryTypingTimer);
      this._cctvSummaryTypingTimer = null;
      return;
    }
    this._cctvSummary.textContent = nextText.slice(0, idx);
  }, 20);
}

export function _updateCctvSyncChip(loading, enabled) {
  if (this.destroyed) return;
  if (!this._cctvSyncChip || !this._cctvSyncLabel || !this._cctvSyncProgress)
    return;
  const total = Number(loading?.total) || 0;
  const loaded = Math.max(0, Math.min(Number(loading?.loaded) || 0, total));
  const busy = !!enabled && !!loading?.active && total > 0;

  if (busy) {
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = null;
    this._cctvChipWasBusy = true;
    this.actions.setSplitFlapText(this._cctvSyncLabel, 'loading frames');
    // The counter is left plain on purpose: it ticks every few frames
    // during a grid load, and flapping it would read as a slot machine.
    this._cctvSyncProgress.textContent = `${loaded}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    return;
  }

  if (this._cctvChipWasBusy && enabled && total > 0) {
    // Load just completed — flash the final count, then auto-hide.
    this._cctvChipWasBusy = false;
    this.actions.setSplitFlapText(this._cctvSyncLabel, 'camera grid ready');
    this._cctvSyncProgress.textContent = `${total}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      this._cctvChipHideTimer = null;
      this._cctvSyncChip.classList.remove('visible');
    }, 1500);
    return;
  }

  if (!this._cctvChipHideTimer) {
    this._cctvChipWasBusy = false;
    this._cctvSyncChip.classList.remove('visible');
  }
}
