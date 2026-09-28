import { selectDesMoinesQuickStart } from './cctvBrowse.js';

export function _initCctvPanel() {
  if (!this._cctvPanel) return;

  this.listen(this._cctvEnableBtn, 'click', async () => {
    this._actionGeneration++;
    await this.actions.toggleEnabled();
    if (!this.destroyed) this._renderCctvState(this._cctvState);
  });

  const rerenderBrowse = () => this._renderCctvState(this._cctvState);
  this.listen(this._cctvRegionFilter, 'change', () => {
    this._cctvBrowseFilters.region = this._cctvRegionFilter.value;
    this._cctvBrowseFilters.route = 'all';
    rerenderBrowse();
  });
  this.listen(this._cctvRouteFilter, 'change', () => {
    this._cctvBrowseFilters.route = this._cctvRouteFilter.value;
    rerenderBrowse();
  });
  this.listen(this._cctvSearch, 'input', () => {
    this._cctvBrowseFilters.query = this._cctvSearch.value;
    rerenderBrowse();
  });
  this.listen(this._cctvFeedFilter, 'click', (event) => {
    const button = event.target.closest?.('[data-cctv-feed]');
    if (!button) return;
    this._cctvBrowseFilters.feed = button.dataset.cctvFeed;
    rerenderBrowse();
  });
  this.listen(this._cctvDesMoinesLiveBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    Object.assign(this._cctvBrowseFilters, {
      region: 'des-moines',
      route: 'all',
      feed: 'video',
      query: '',
    });
    if (this._cctvRegionFilter) this._cctvRegionFilter.value = 'des-moines';
    if (this._cctvSearch) this._cctvSearch.value = '';
    this.actions.setPanelCollapsed('cctv-panel', false, { explicit: true });
    this._renderCctvState(this._cctvState);
    if (!(await this.actions.toggleEnabled(true))) return;
    if (this.destroyed || generation !== this._actionGeneration) return;
    this._renderCctvState(this._cctvState);
    const camera = selectDesMoinesQuickStart(this._cctvState?.cameras);
    if (!camera) {
      this.actions.showToast?.('No Des Moines cameras are currently available');
      return;
    }
    this._cctvPlaybackState = 'connecting';
    this.actions.setParams(
      { showProjection: true, selectedCameraId: camera.id },
      { origin: 'user' },
    );
    this.actions.runExplicitFocus(
      () => (this.cctv.selectCamera(camera.id) ? camera.id : null),
      (cameraId) => this.cctv.focusCamera(cameraId, 2.2),
    );
  });

  this.listen(this._cctvNearestBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () =>
        this.cctv.focusNearest({
          focus: false,
          cameraIds: this._cctvFilteredCameraIds,
        }),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.8),
    );
  });

  this.listen(this._cctvPrevBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () =>
        this.cctv.cycleCamera(-1, {
          cameraIds: this._cctvFilteredCameraIds,
        }),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.4),
    );
  });

  this.listen(this._cctvNextBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () =>
        this.cctv.cycleCamera(1, {
          cameraIds: this._cctvFilteredCameraIds,
        }),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.4),
    );
  });

  this.listen(this._cctvSelect, 'change', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    const cameraId = this._cctvSelect.value;
    if (!cameraId) return;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    // Picking a camera from the dropdown flies to it. The catalog spans
    // three metros, so a bare selection used to leave the view in the old
    // city with a camera active thousands of km away.
    this.actions.runExplicitFocus(
      () => (this.cctv.selectCamera(cameraId) ? cameraId : null),
      (selectedId) => this.cctv.focusCamera(selectedId, 2.2),
    );
    this.actions.setParams({ selectedCameraId: cameraId }, { origin: 'user' });
  });

  this.listen(this._cctvFocusBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    const selected = this._cctvState?.activeCameraId || this._cctvSelect?.value;
    if (!selected) return;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () => selected,
      (cameraId) => this.cctv.focusCamera(cameraId, 1.9),
    );
    this.actions.setParams({ selectedCameraId: selected }, { origin: 'user' });
  });

  this.listen(this._cctvCoverageBtn, 'click', () => {
    const current =
      this._cctvState?.coverageMode ||
      (this._cctvState?.showCoverage ? 'on' : 'off');
    const next =
      current === 'off' ? 'on' : current === 'on' ? 'viewshed' : 'off';
    this.actions.setParams({ coverageMode: next }, { origin: 'user' });
  });

  this.listen(this._cctvAutoHopBtn, 'click', () => {
    const current = !!this._cctvState?.autoHop;
    this.actions.setParams({ autoHop: !current }, { origin: 'user' });
  });

  this.listen(this._cctvProjectionBtn, 'click', () => {
    const current = this._cctvState?.showProjection !== false;
    this.actions.setParams({ showProjection: !current }, { origin: 'user' });
  });

  this.listen(this._cctvAdjustBtn, 'click', () => {
    const current = !!this._cctvState?.calibrationMode;
    this.actions.setParams({ calibrationMode: !current }, { origin: 'user' });
  });

  // Click-to-edit pose readout: each chip swaps to a number input; Enter or
  // blur commits (converted to a calibration offset against basePose),
  // Escape cancels. Delegated so re-renders never re-bind.
  this.listen(this._cctvCalReadout, 'click', (event) => {
    const chip = event.target.closest?.('.cctv-cal-value');
    if (!chip || chip.disabled || chip.querySelector('input')) return;
    this._beginCctvCalValueEdit(chip);
  });

  this.listen(this._cctvCalibSaveBtn, 'click', () => {
    const cameraId = this._activeCctvCameraId();
    if (!cameraId || !this.actions.setParams) return;
    this.actions.setParams(
      {
        selectedCameraId: cameraId,
        calibration: { cameraId, save: true },
      },
      { origin: 'user' },
    );
    this.actions.showToast('CCTV calibration saved');
  });

  this.listen(this._cctvCalibResetBtn, 'click', () => {
    this._resetCctvCalibration();
  });

  this._renderCctvState(null);
  this.actions.syncViewport();
}
