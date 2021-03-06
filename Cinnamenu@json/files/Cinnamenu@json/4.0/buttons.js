const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const {AppState} = imports.gi.Cinnamon;
const {EllipsizeMode} = imports.gi.Pango;
const Main = imports.ui.main;
const {PopupBaseMenuItem, PopupSubMenu, PopupIconMenuItem, PopupSeparatorMenuItem} = imports.ui.popupMenu;
const {DragMotionResult, makeDraggable} = imports.ui.dnd;
const {getUserDesktopDir, changeModeGFile} = imports.misc.fileUtils;
const {SignalManager} = imports.misc.signalManager;
const {spawnCommandLine, spawn, unref} = imports.misc.util;
const MessageTray = imports.ui.messageTray;

const {SEARCH_DEBUG, _, APPTYPE, tryFn, showTooltip, hideTooltip} = require('./utils');
const {MODABLE, MODED} = require('./emoji');
const PlacementTOOLTIP = 1, PlacementUNDER = 2, PlacementNONE = 3;
const SHOW_SEARCH_MARKUP_IN_TOOLTIP = true;
const USER_DESKTOP_PATH = getUserDesktopDir();
const CAN_UNINSTALL = GLib.file_test('/usr/bin/cinnamon-remove-application', GLib.FileTest.EXISTS);

class CategoryListButton extends PopupBaseMenuItem {
    constructor(appThis, dir, altNameText, altIconNames/*array of names*/) {
        super({ hover: false, activate: false });
        this.appThis = appThis;
        this.signals = new SignalManager(null);
        this.index = -1;
        this.disabled = false;
        this.entered = null;
        let isStrDir = typeof dir === 'string';
        if (isStrDir) {
            this.id = dir;
            this.categoryNameText = altNameText;
        } else {
            this.id = altNameText;
            const dirName = dir.get_name();
            this.categoryNameText = dirName ? dirName : '';
        }

        if (!isStrDir) {
            let icon = dir.get_icon();
            let iconName = '';
            if (icon) {
                if (icon.names) {
                    iconName = icon.names[0];
                }
                if (!iconName && icon.get_names) {
                    iconName = icon.get_names()[0];
                }
            }
            if (iconName === '') {
                iconName = 'folder';
            }
            this.icon = new St.Icon({   icon_name: iconName, icon_type: St.IconType.FULLCOLOR,
                                        icon_size: this.appThis.settings.categoryIconSize});
        } else {
            this.icon = new St.Icon({   gicon: Gio.ThemedIcon.new_from_names(altIconNames),
                                        icon_size: this.appThis.settings.categoryIconSize,
                                        icon_type: St.IconType.FULLCOLOR });
        }
        if (this.appThis.settings.categoryIconSize > 0) {
            this.addActor(this.icon);
        }


        //this.categoryNameText = categoryNameText;
        this.label = new St.Label({ text: this.categoryNameText,
                                    style_class: 'menu-category-button-label' });
        this.addActor(this.label);
        this.label.realize();

        //?undo
        this.actor._delegate = {
                handleDragOver: (source /*, actor, x, y, time */) => {
                        if (!source.index || source.index === this.index) {
                                return DragMotionResult.NO_DROP;
                        }
                        this.appThis.resetCategoryOpacity();
                        this.actor.set_opacity(50);
                        return DragMotionResult.MOVE_DROP; },
                acceptDrop: (source /*, actor, x, y, time */) => {
                        if (!source.index || source.index === this.index) {
                            this.appThis.resetCategoryOpacity();
                            return DragMotionResult.NO_DROP;
                        }
                        this.appThis.moveCategoryToPos(source.id, this.id);
                        return true; },
                getDragActorSource: () => this.actor,
                _getDragActor: () => new Clutter.Clone({source: this.actor}),
                getDragActor: () => new Clutter.Clone({source: this.icon}),
                isDraggableApp: false,
                index: this.index,
                id: this.id };

        this.draggable = makeDraggable(this.actor);

        // Connect signals
        this.signals.connect(this.draggable, 'drag-begin', (...args) => this.onDragBegin(...args));
        this.signals.connect(this.draggable, 'drag-cancelled', (...args) => this.onDragCancelled(...args));
        this.signals.connect(this.draggable, 'drag-end', (...args) => this.onDragEnd(...args));
        //?undo

        this.signals.connect(this.actor, 'enter-event', (...args) => this.handleEnter(...args));
        this.signals.connect(this.actor, 'leave-event', (...args) => this.handleLeave(...args));
        this.signals.connect(this.actor, 'button-release-event', (...args) => this.handleButtonRelease(...args));
    }

    onDragBegin() {
        this.actor.set_opacity(51);
        //this.appThis.categoryDragged = true;
    }

    onDragCancelled() {
        this.actor.set_opacity(255);
        //this.appThis.categoryDragged = false;
    }

    onDragEnd() {
        this.appThis.resetCategoryOpacity();
        //this.actor.set_opacity(255);
        //setTimeout(() => { this.appThis.categoryDragged = false; }, 0);
    }

    selectCategory() {
        if (this.appThis.settings.categoryClick) {
            this.actor.set_style('');//undo fixes applied in handleEnter();
        }
        this.appThis.setActiveCategory(this.id);
    }

    handleEnter(actor, event) {
        if (this.disabled || this.appThis.contextMenu.isOpen) {
            return Clutter.EVENT_STOP;
        }

        if (event) {//?undo
            this.appThis.clearEnteredActors();
        } else {
            this.appThis.scrollToButton(this, true);
        }

        //this.appThis.scrollToButton(this, true);

        this.entered = true;
        if (this.appThis.settings.categoryClick) {
            if (this.id != this.appThis.currentCategory) {
                this.actor.set_style_class_name('menu-category-button-selected menu-category-button-hover');
                //fix menu-category-button-hover for Mint-Y themes
                const bgColor = this.actor.get_theme_node().get_background_color().to_string();
                if (bgColor === '#ff0000ff') {
                    const menubgColor = this.appThis.menu.actor.get_theme_node().get_background_color();
                    if (menubgColor.red > 128) {
                        this.actor.set_style('background-color: #e4e4e4; color: black;');
                    } else {
                        this.actor.set_style('background-color: #404040;');
                    }
                }
            }
            return Clutter.EVENT_STOP;
        } else {
            this.selectCategory();
            return Clutter.EVENT_STOP;
        }
    }

    handleLeave(actor, event) {
        if (this.disabled || this.appThis.contextMenu.isOpen) {
            return false;
        }
        this.entered = null;
        if ((!event || this.appThis.settings.categoryClick) && this.appThis.currentCategory !== this.id) {
            if (this.id != this.appThis.currentCategory) {
                this.actor.set_style_class_name('menu-category-button');
            } else {
                this.actor.set_style_class_name('menu-category-button-selected');
            }
            this.actor.set_style('');//undo fixes applied in handleEnter();
        }
    }

    handleButtonRelease(actor, event) {
        if (this.disabled) {
            return;
        }
        if (this.appThis.contextMenu.isOpen) {
            this.appThis.contextMenu.close();
            return Clutter.EVENT_STOP;
        }
        const button = event.get_button();
        if (button === 1 && this.appThis.settings.categoryClick) {
            this.selectCategory();
            return Clutter.EVENT_STOP;
        } else if (button === 3) {
            this.appThis.contextMenu.open(this.id, event, this, true);
            return Clutter.EVENT_STOP;
        }
    }

    disable() {
        if (this.actor.has_style_class_name('menu-category-button-greyed')) {
            return false;
        }

        this.actor.set_style_class_name('menu-category-button-greyed');
        this.disabled = true;
        this.entered = null;
    }

    enable() {
        this.actor.set_style_class_name('menu-category-button');
        this.disabled = false;
    }

    destroy() {
        this.signals.disconnectAllSignals();
        this.label.destroy();
        if (this.icon) {
            this.icon.destroy();
        }
        PopupBaseMenuItem.prototype.destroy.call(this);
        unref(this);
    }
}

class ContextMenuItem extends PopupIconMenuItem {
    constructor(appThis, label, iconName, action) {
        super(label, iconName, St.IconType.SYMBOLIC, {focusOnHover: false});
        this.appThis = appThis;
        this.signals = new SignalManager(null);
        this.action = action;

        if (this.action == null) {
            this.actor.style = "font-weight: bold";
        }
        this.signals.connect(this.actor, 'enter-event', (...args) => this.handleEnter(...args));
        this.signals.connect(this.actor, 'leave-event', (...args) => this.handleLeave(...args));
    }

    handleEnter(actor, e) {
        if (this.action === null) {
            return Clutter.EVENT_STOP;
        }
        this.entered = true;
        this.actor.add_style_pseudo_class('hover');// Should be 'hover' only, add 'active' for
        this.actor.add_style_pseudo_class('active');//compatability with existing themes
        return Clutter.EVENT_STOP;//true;
    }

    handleLeave(actor, e) {
        this.entered = null;
        this.actor.remove_style_pseudo_class('hover');
        this.actor.remove_style_pseudo_class('active');
        return Clutter.EVENT_STOP;
    }

    activate(event) {
        if (!this.action || event && event.get_button() !== 1) {
            return false;
        }
        this.action();
        return false;
    }

    destroy() {
        this.signals.disconnectAllSignals();
        PopupBaseMenuItem.prototype.destroy.call(this);
        unref(this);
    }
}

class ContextMenu {
    constructor(appThis) {
        this.appThis = appThis;
        this.menu = new PopupSubMenu(this.appThis.actor);//popup-sub-menu menu menu-context-menu starkmenu-background
        this.menu.actor.set_style_class_name('menu menu-context-menu starkmenu-background'); //menu-background
        this.contextMenuBox = new St.BoxLayout({ style_class: '',// style: 'border: 0px;',
                                                    vertical: true, reactive: true });
        this.contextMenuBox.add_actor(this.menu.actor);
        this.contextMenuBox.height = 0;
        //appThis.mainBox.add(this.contextMenuBox, {expand: false, x_fill: false, //y_fill: false,
        //                                        x_align: St.Align.START, y_align: St.Align.MIDDLE});
        this.contextMenuButtons = [];
        this.isOpen = false;
    }

    open(app, e, button, category = false) {
        //e is used to position context menu at mouse coords. If keypress opens menu then
        // e is undefined and button position is used instead,
        for (let i = 0; i < this.contextMenuButtons.length; i++) {
            this.contextMenuButtons[i].destroy();
            this.contextMenuButtons[i] = null;
        }
        this.contextMenuButtons = [];

        if (category) {
            const addMenuItem = (item) => {
                this.menu.addMenuItem(item);
                this.contextMenuButtons.push(item);
            };
            addMenuItem( new ContextMenuItem(this.appThis, _('Reset category order'), null,
                                () => { this.appThis.resetCategoryOrder();
                                        this.close(); } ));
        } else if (app.type === APPTYPE.application) {
            this.populateContextMenu_apps(app);
        } else if (app.type === APPTYPE.file) {
            if (!GLib.file_test(Gio.File.new_for_uri(app.uri).get_path(), GLib.FileTest.EXISTS)) {
                Main.notify(_("This file is no longer available"),'');
                return;
            }
            this.populateContextMenu_files(app);
        } else if (app.type == APPTYPE.provider) {//Emoji
            if (!MODABLE.includes(app.icon)) {
                return;
            }
            const addMenuItem = (char, text) => {
                const i = MODABLE.indexOf(app.icon);
                let newEmoji = MODED[i].replace('\u{1F3FB}', char);
                newEmoji = newEmoji.replace('\u{1F3FB}', char);
                const item = new ContextMenuItem(this.appThis, newEmoji + ' ' + text, null,
                                        () => { const clipboard = St.Clipboard.get_default();
                                                clipboard.set_text(St.ClipboardType.CLIPBOARD, newEmoji);
                                                this.appThis.closeMenu(); } );
                this.menu.addMenuItem(item);
                this.contextMenuButtons.push(item);
            };
            addMenuItem('\u{1F3FB}', 'light skin tone');
            addMenuItem('\u{1F3FC}', 'medium-light skin tone');
            addMenuItem('\u{1F3FD}', 'medium skin tone');
            addMenuItem('\u{1F3FE}', 'medium-dark skin tone');
            addMenuItem('\u{1F3FF}', 'dark skin tone');
        }

        this.isOpen = true;

        const contextMenuWidth = this.menu.actor.width;
        const contextMenuHeight = this.menu.actor.height;

        const monitor = Main.layoutManager.findMonitorForActor(this.menu.actor);
        let mx, my;
        if (e) {
            [mx, my] = e.get_coords(); //get mouse position
        } else {//activated by keypress, no e supplied
            [mx, my] = button.actor.get_transformed_position();
            mx += 20;
            my += 20;
        }
        if (mx > monitor.x + monitor.width - this.menu.actor.width) {
            mx -= this.menu.actor.width;
        }
        if (my > monitor.y + monitor.height - this.menu.actor.height - 40/*allow for panel*/) {
            my -= this.menu.actor.height;
        }
        //setting anchor_x & anchor_y sets it relative to it's current position but negative???
        let [cx, cy] = this.contextMenuBox.get_transformed_position();
        cx = Math.round(mx - cx);
        cy = Math.round(my - cy);
        this.menu.actor.anchor_x = -cx;
        this.menu.actor.anchor_y = -cy;

        this.menu.toggle_with_options(this.appThis.settings.enableAnimation);
        return;
    }

    populateContextMenu_apps(app) { //add items to context menu of type: application
        const addMenuItem = (item) => {
            this.menu.addMenuItem(item);
            this.contextMenuButtons.push(item);
        };
        if (this.appThis.gpu_offload_supported) {
            addMenuItem( new ContextMenuItem(this.appThis, _('Run with NVIDIA GPU'), 'cpu',
                                () => { try {
                                            app.launch_offloaded(0, [], -1);
                                        } catch (e) {
                                            logError(e, 'Could not launch app with dedicated gpu: ');
                                        }
                                        this.appThis.closeMenu(); } ));
        } else if (this.appThis.isBumblebeeInstalled) {
            addMenuItem( new ContextMenuItem(this.appThis, _('Run with NVIDIA GPU'), 'cpu',
                                () => { spawnCommandLine('optirun gtk-launch ' + app.get_id());
                                        this.appThis.closeMenu(); } ));
        }
        addMenuItem( new ContextMenuItem(this.appThis, _('Add to panel'), 'list-add',
            () => {
                if (!Main.AppletManager.get_role_provider_exists(Main.AppletManager.Roles.PANEL_LAUNCHER)) {
                    const new_applet_id = global.settings.get_int('next-applet-id');
                    global.settings.set_int('next-applet-id', (new_applet_id + 1));
                    const enabled_applets = global.settings.get_strv('enabled-applets');
                    enabled_applets.push('panel1:right:0:panel-launchers@cinnamon.org:' + new_applet_id);
                    global.settings.set_strv('enabled-applets', enabled_applets);
                }
                Main.AppletManager.get_role_provider(Main.AppletManager.Roles.PANEL_LAUNCHER)
                                                                            .acceptNewLauncher(app.get_id());
                this.close(); } ));
        if (USER_DESKTOP_PATH) {
            addMenuItem( new ContextMenuItem(this.appThis, _('Add to desktop'), 'computer',
                () => { const destFile = Gio.file_new_for_path(USER_DESKTOP_PATH + '/' + app.get_id());
                        tryFn(() => {
                            Gio.file_new_for_path(app.get_app_info().get_filename())
                                .copy(  Gio.file_new_for_path(USER_DESKTOP_PATH + '/' + app.get_id()), 0, null, null);
                            changeModeGFile(destFile, 755);
                        }, function(e) {
                            global.log(e);
                        });
                        this.close(); } ));
        }
        if (this.appThis.appFavorites.isFavorite(app.get_id())) {
            addMenuItem( new ContextMenuItem(this.appThis, _('Remove from favorites'), 'starred',
                                            () => { this.appThis.appFavorites.removeFavorite(app.get_id());
                                            this.close(); } ));
        } else {
            addMenuItem( new ContextMenuItem(this.appThis, _('Add to favorites'), 'non-starred',
                                        () => { this.appThis.appFavorites.addFavorite(app.get_id());
                                        this.close(); } ));
        }
        if (CAN_UNINSTALL) {
            addMenuItem( new ContextMenuItem(this.appThis, _('Uninstall'), 'edit-delete',
                        () => { spawnCommandLine('/usr/bin/cinnamon-remove-application \'' +
                                                                app.get_app_info().get_filename() + '\'');
                                this.appThis.closeMenu();} ));
        }
    }

    populateContextMenu_files(app) {
        const addMenuItem = (item) => {
            this.menu.addMenuItem(item);
            this.contextMenuButtons.push(item);
        };
        const hasLocalPath = (file) => (file.is_native() && file.get_path() != null);
        //
        addMenuItem( new ContextMenuItem(this.appThis, _("Open with"), null, null ));
        const file = Gio.File.new_for_uri(app.uri);
        const defaultInfo = Gio.AppInfo.get_default_for_type(app.mimeType, !hasLocalPath(file));
        if (defaultInfo) {
            addMenuItem( new ContextMenuItem(   this.appThis, defaultInfo.get_display_name(), null,
                                                () => { defaultInfo.launch([file], null);
                                                        this.appThis.closeMenu(); } ));
        }
        //
        const infos = Gio.AppInfo.get_all_for_type(app.mimeType);
        for (let i = 0; i < infos.length; i++) {
            const info = infos[i];
            //const file = Gio.File.new_for_uri(app.uri);
            if (!hasLocalPath(file) || !info.supports_uris() || info.equal(defaultInfo)) {
                continue;
            }
            addMenuItem( new ContextMenuItem(   this.appThis, info.get_display_name(), null,
                                                () => { info.launch([file], null);
                                                        this.appThis.closeMenu(); } ));
        }
        //
        addMenuItem( new ContextMenuItem(   this.appThis, _('Other application...'), null,
                                            () => { spawnCommandLine("nemo-open-with " + app.uri);
                                                    this.appThis.closeMenu(); } ));
        const folder = file.get_parent();
        if (app.description) { //if recent item (not a browser folder/file)
            this.menu.addMenuItem(new PopupSeparatorMenuItem(this.appThis));
            addMenuItem( new ContextMenuItem(   this.appThis, _('Open containing folder'), null,
                        () => { const fileBrowser = Gio.AppInfo.get_default_for_type('inode/directory', true);
                                fileBrowser.launch([folder], null);
                                this.appThis.closeMenu(); } ));
        }
    }

    close() {
        /*if (this.isOpen) {
            this.menu.toggle_with_options(this.appThis.settings.enableAnimation);
        }*/
        this.menu.close();
        this.isOpen = false;
    }

    destroy() {
        return true;
    }
}

class AppListGridButton extends PopupBaseMenuItem {
    constructor(appThis, app) {
        super({ hover: false, activate: false });
        this.appThis = appThis;
        this.app = app;
        this.actor.set_style_class_name('menu-application-button');
        if (!this.appThis.isListView) {
            this.actor.set_style('padding-left: 0px; padding-right: 0px;');
        }
        this.actor.x_align = this.appThis.isListView ? St.Align.START : St.Align.MIDDLE;
        this.actor.y_align = St.Align.MIDDLE;
        if (!this.appThis.isListView) {
            this.actor.width = this.appThis.appsView.applicationsGridBox.width /
                                                                this.appThis.settings.appsGridColumnCount;
        }
        this.signals = new SignalManager(null);
        this.entered = null;
        //----------ICON---------------------------------------------
        //create icon even if iconSize is 0 so dnd has something to drag
        if (this.app.type === APPTYPE.application) {
            this.icon = this.app.create_icon_texture(this.appThis.getIconSize());
        } else if (this.app.type === APPTYPE.place) {
            if (this.app.icon instanceof St.Icon) {
                this.icon = this.app.icon;
            } else {
                this.icon = new St.Icon({ gicon: this.app.icon, icon_size: this.appThis.getIconSize()});
            }
        } else if (this.app.type === APPTYPE.file) {
            if (this.app.icon) {
                this.icon = new St.Icon({ gicon: this.app.icon, icon_size: this.appThis.getIconSize()});
            } else {//back button
                this.icon = new St.Icon({ icon_name: 'edit-undo-symbolic', icon_size: this.appThis.getIconSize()});
            }
        } else if (this.app.type === APPTYPE.clearlist) {
            this.icon = new St.Icon({   icon_name: 'edit-clear', icon_type: St.IconType.SYMBOLIC,
                                        icon_size: this.appThis.getIconSize()});
        } else if (this.app.type === APPTYPE.provider) {
            if (typeof this.app.icon !== 'string') {
                this.icon = this.app.icon;
            } else { //emoji
                const iconLabel = new St.Label({ style_class: '', style: 'color: white; font-size: ' +
                                                (Math.round(this.appThis.getIconSize() * 0.85)) + 'px;'});
                iconLabel.get_clutter_text().set_markup(this.app.icon);
                this.icon = iconLabel;
            }
        }
        if (!this.icon) {
            this.icon = new St.Icon({   icon_name: 'error',
                                        icon_size: this.appThis.getIconSize(),
                                        icon_type: St.IconType.FULLCOLOR});
        }
        //--------Label------------------------------------
        this.label = new St.Label({ style_class: 'menu-application-button-label',
                                    style: 'padding-right: 2px; padding-left: 2px;'});
        if (!this.appThis.isListView && this.appThis.settings.descriptionPlacement === PlacementUNDER) {
            this.label.set_style('text-align: center;');
        }
        this.formatLabel();
        this.iconContainer = new St.BoxLayout();
        if (this.icon && this.appThis.getIconSize() > 0) {
            this.iconContainer.add(this.icon, { x_fill: false, y_fill: false,
                                                x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE});
        }
        this.dot = new St.Widget({
                style: this.appThis.isListView ?
                'width: 2px; height: 12px; background-color: ' + this.appThis.getThemeForegroundColor() +
                                                    '; margin: 0px; border: 1px; border-radius: 10px;' :
                'width: 32px; height: 2px; background-color: ' + this.appThis.getThemeForegroundColor() +
                                                    '; margin: 0px; border: 1px; border-radius: 10px;',
                layout_manager: new Clutter.BinLayout(),
                x_expand: false,
                y_expand: false});
        //-------------------buttonBox-------------------------
        this.buttonBox = new St.BoxLayout({ vertical: !this.appThis.isListView, y_expand: false });
        if (!this.appThis.isListView) {
            this.buttonBox.width = 600;//bigger than needed to ensure it centers in it's grid space
        } else {
            this.buttonBox.width = this.appThis.appBoxWidth - 30;//omitting this causes list scrolling to slow down
        }
        this.buttonBox.add(this.iconContainer, {
                                x_fill: false, y_fill: false,
                                x_align: this.appThis.isListView ? St.Align.START : St.Align.MIDDLE,
                                y_align: St.Align.MIDDLE});
        this.buttonBox.add(this.dot, {  x_fill: false, y_fill: false,
                                        x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
        this.buttonBox.add(this.label, {
                                x_fill: false, y_fill: false,
                                x_align: this.appThis.isListView ? St.Align.START : St.Align.MIDDLE,
                                y_align: St.Align.MIDDLE});
        this.addActor(this.buttonBox);
        if (this.icon) {
            this.icon.realize();
        }

        if (this.app.type === APPTYPE.application) { //----------dnd--------------
            this.actor._delegate = {
                    handleDragOver: (source) => {
                            if (source.isDraggableApp === true && source.get_app_id() !== this.app.get_id() &&
                                                                    this.appThis.currentCategory === 'favorites') {
                                this.appThis.resetOpacity();
                                this.actor.set_opacity(40);
                                return DragMotionResult.MOVE_DROP;
                            }
                            return DragMotionResult.NO_DROP; },
                    handleDragOut: () => {  this.actor.set_opacity(255); },
                    acceptDrop: (source) => {
                            if (source.isDraggableApp === true && source.get_app_id() !== this.app.get_id() &&
                                                                this.appThis.currentCategory === 'favorites') {
                                this.actor.set_opacity(255);
                                this.appThis.addFavoriteToPos(source.get_app_id(), this.app.get_id());
                                return true;
                            } else {
                                this.actor.set_opacity(255);
                                return DragMotionResult.NO_DROP;
                            } },
                    getDragActorSource: () => this.actor,
                    _getDragActor: () => new Clutter.Clone({source: this.actor}),
                    getDragActor: () => new Clutter.Clone({source: this.icon}),
                    get_app_id: () => this.app.get_id(),
                    isDraggableApp: this.app.type === APPTYPE.application
            };

            this.draggable = makeDraggable(this.actor);
            this.signals.connect(this.draggable, 'drag-begin', (...args) => this.onDragBegin(...args));
            this.signals.connect(this.draggable, 'drag-cancelled', (...args) => this.onDragCancelled(...args));
            this.signals.connect(this.draggable, 'drag-end', (...args) => this.onDragEnd(...args));
        }

        //----running state
        this.dot.opacity = 0;
        if (this.app.type === APPTYPE.application) {
            this.signals.connect(this.app, 'notify::state', (...args) => this.onStateChanged(...args));
            this.onStateChanged();
        }

        this.signals.connect(this.actor, 'button-press-event', (...args) => this.handleButtonPress(...args));
        this.signals.connect(this.actor, 'button-release-event', (...args) => this.handleButtonRelease(...args));
        this.signals.connect(this.actor, 'enter-event', (...args) => this.handleEnter(...args));
        this.signals.connect(this.actor, 'leave-event', (...args) => this.handleLeave(...args));
    }

    onDragBegin() {
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
    }

    onDragCancelled() {
    }

    onDragEnd() {
        this.appThis.resetOpacity();
    }

    formatLabel() {
        let name = this.app.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        let description = this.app.description ?
                            this.app.description.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';

        if (this.app.newAppShouldHighlight) {
            if (!this.actor.has_style_pseudo_class('highlighted')) {
                this.actor.add_style_pseudo_class('highlighted'); //'font-weight: bold;';
            }
        } else {
            if (this.actor.has_style_pseudo_class('highlighted')) {
                this.actor.remove_style_pseudo_class('highlighted');
            }
        }
        let markup = '<span>' + name + '</span>';
        if (this.appThis.settings.descriptionPlacement === PlacementUNDER && description) {
            markup += '\n<span size="small">' + description + '</span>';
        }
        const clutterText = this.label.get_clutter_text();
        clutterText.set_markup(markup);
        /*if (this.app.type === APPTYPE.file && !description) {
            clutterText.set_line_wrap(true);
            clutterText.set_line_wrap_mode(2);//WORD_CHAR
            const lines = clutterText.get_layout().get_lines();
            global.log(clutterText.get_text());
        } else {*/
            clutterText.ellipsize = EllipsizeMode.END;
        //}
    }

    handleEnter(actor, event) {
        if (this.appThis.contextMenu.isOpen ) {
            return false;
        }

        if (event) {
            this.appThis.clearEnteredActors();
        } else {
            this.appThis.scrollToButton(this);
        }

        this.entered = true;
        this.actor.set_style_class_name('menu-application-button-selected');

        if (this.appThis.settings.descriptionPlacement === PlacementTOOLTIP) {
            const wordWrap = text => text.match( /.{1,80}(\s|$|-|=|\+)|\S+?(\s|$|-|=|\+)/g ).join('\n');
            let tooltipMarkup = '<span>' + wordWrap((this.app.nameWithSearchMarkup &&
                                            SHOW_SEARCH_MARKUP_IN_TOOLTIP && this.appThis.searchActive) ?
                                            this.app.nameWithSearchMarkup : this.app.name) + '</span>';
            if (this.app.description) {
                tooltipMarkup += '\n<span size="small">' + wordWrap((this.app.descriptionWithSearchMarkup &&
                                    SHOW_SEARCH_MARKUP_IN_TOOLTIP && this.appThis.searchActive) ?
                                    this.app.descriptionWithSearchMarkup : this.app.description) + '</span>';
            }
            if (SEARCH_DEBUG) {
                if (SHOW_SEARCH_MARKUP_IN_TOOLTIP && this.app.keywordsWithSearchMarkup &&
                                                                                this.appThis.searchActive) {
                    tooltipMarkup += '\n<span size="small">' +
                                                wordWrap(this.app.keywordsWithSearchMarkup) + '</span>';
                }
                if (SHOW_SEARCH_MARKUP_IN_TOOLTIP && this.app.idWithSearchMarkup && this.appThis.searchActive) {
                    tooltipMarkup += '\n<span size="small">' + wordWrap(this.app.idWithSearchMarkup) + '</span>';
                }
            }
            tooltipMarkup = tooltipMarkup.replace(/&/g, '&amp;');

            let [x, y] = this.actor.get_transformed_position();
            let {width, height} = this.actor;
            let center_x = false; //should tooltip x pos. be centered on x
            if (this.appThis.isListView) {
                x += 175 * global.ui_scale;
                y += height + 8 * global.ui_scale;
            } else {//grid view
                x += Math.floor(width / 2);
                y += height + 8 * global.ui_scale;
                center_x = true;
            }
            if (!this.tooltip) {/*handleEnter may have been called twice, once with key nav and again with mouse.
                                 *In which case, don't create new tooltip*/
                showTooltip(this.actor, x, y, center_x, tooltipMarkup);
                this.tooltip = true;
            }
        }
        return false;
    }

    handleLeave(actor, event) {
        if (this.appThis.contextMenu.isOpen) {
            return false;
        }

        this.entered = null;
        this.actor.set_style_class_name('menu-application-button');
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
    }

    handleButtonPress() {
        //this.appThis.categoryDragged = true;
    }

    handleButtonRelease(actor, e) {
        const button = e.get_button();
        if (button === 1) {//left click
            if (this.appThis.contextMenu.isOpen) {
                //if (this.menuIsOpen && this.menu._activeMenuItem) {
                //    this.menu._activeMenuItem.activate();
                this.appThis.contextMenu.close();
                this.appThis.clearEnteredActors();
                this.handleEnter();
            } else {
                this.activate(e);
            }
            return Clutter.EVENT_STOP;
        } else if (button === 3) {//right click
            if (this.appThis.contextMenu.isOpen) {
                this.appThis.contextMenu.close();
                this.appThis.clearEnteredActors();
                this.handleEnter();
                return Clutter.EVENT_STOP;
            } else {
                if (this.app.type == APPTYPE.application || this.app.type == APPTYPE.file ||
                            this.app.type == APPTYPE.provider && typeof this.app.icon === 'string' ){//emoji
                    this.openContextMenu(e);
                }
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    activate() {
        if (this.app.type === APPTYPE.application) {
            this.app.newAppShouldHighlight = false;
            this.app.open_new_window(-1);
            this.appThis.closeMenu();
        } else if (this.app.type === APPTYPE.place) {
            if (this.app.uri) {
                this.app.app.launch_uris([this.app.uri], null);
            } else {
                this.app.launch();
            }
            this.appThis.closeMenu();
        } else if (this.app.type === APPTYPE.file) {
            if (this.app.directory) {
                this.appThis.setActiveCategory(Gio.File.new_for_uri(this.app.uri).get_path());
                return;
            }
            try {
                Gio.app_info_launch_default_for_uri(this.app.uri, global.create_app_launch_context());
                this.appThis.closeMenu();
            } catch (e) {
                Main.notify(_("This file is no longer available"),e.message);
                //don't closeMenu
            }
        } else if (this.app.type === APPTYPE.clearlist) {
            Gtk.RecentManager.get_default().purge_items();
            this.appThis.setActiveCategory('all');
            //don't closeMenu
        } else if (this.app.type === APPTYPE.provider) {
            this.app.activate(this.app);
            this.appThis.closeMenu();
        }
    }

    onStateChanged() {
        if (!this.app || this.dot.is_finalized()) {
            return false;
        }
        if (this.app.type === APPTYPE.application) {
            this.dot.opacity = this.app.state !== AppState.STOPPED ? 255 : 0;
        }
        return true;
    }

    openContextMenu(e) {
        this.actor.set_style_class_name('menu-application-button-selected');
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
        if (!this.actor.get_parent()) {
            return; // Favorite change ??
        }
        this.appThis.contextMenu.open(this.app, e, this);
    }

    destroy(skipDestroy) {
        this.signals.disconnectAllSignals();

        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
        if (!skipDestroy) {
            this.dot.destroy();
            this.label.destroy();
            if (this.icon) {
                this.icon.destroy();
            }
            if (this.iconContainer) {
                this.iconContainer.destroy();
            }
            this.buttonBox.destroy();
        }
        PopupBaseMenuItem.prototype.destroy.call(this);
        //unref(this);
    }
}

class GroupButton extends PopupBaseMenuItem {
    constructor(appThis, icon, app, name, description, callback) {
        super({ hover: false, activate: false });
        this.appThis = appThis;
        this.signals = new SignalManager(null);
        this.app = app;
        this.name = name;
        this.description = description;
        this.callback = callback;
        this.actor.set_style_class_name('menu-favorites-button');
        this.entered = null;
        if (icon) {
            this.icon = icon;
            this.addActor(this.icon);
            this.icon.realize();
        }

        if (this.app) { //----------dnd--------------
            this.actor._delegate = {
                    handleDragOver: (source) => {
                            if (source.isDraggableApp === true && source.get_app_id() !== this.app.get_id()) {
                                this.actor.set_opacity(40);
                                return DragMotionResult.MOVE_DROP;
                            }
                            return DragMotionResult.NO_DROP; },
                    handleDragOut: () => { this.actor.set_opacity(255); },
                    acceptDrop: (source) => {
                            if (source.isDraggableApp === true && source.get_app_id() !== this.app.get_id()) {
                                this.actor.set_opacity(255);
                                this.appThis.addFavoriteToPos(source.get_app_id(), this.app.get_id());
                                return true;
                            } else {
                                this.actor.set_opacity(255);
                                return DragMotionResult.NO_DROP;
                            } },
                    getDragActorSource: () => this.actor,
                    _getDragActor: () => new Clutter.Clone({source: this.actor}),
                    getDragActor: () => new Clutter.Clone({source: this.icon}),
                    get_app_id: () => this.app.get_id(),
                    isDraggableApp: true
            };

            this.draggable = makeDraggable(this.actor);
            this.signals.connect(this.draggable, 'drag-begin', (...args) => this.onDragBegin(...args));
            //this.signals.connect(this.draggable, 'drag-cancelled', (...args) => this.onDragCancelled(...args));
            //this.signals.connect(this.draggable, 'drag-end', (...args) => this.onDragEnd(...args));
        }

        this.signals.connect(this.actor, 'enter-event', (...args) => this.handleEnter(...args));
        this.signals.connect(this.actor, 'leave-event', (...args) => this.handleLeave(...args));
        this.signals.connect(this.actor, 'button-release-event', (...args) => this.handleButtonRelease(...args));
    }

    onDragBegin() {
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
    }

    handleButtonRelease(actor, e) {
        const button = e.get_button();
        if (button === 1) {//left click
            if (this.appThis.contextMenu.isOpen) {
                //if (this.menuIsOpen && this.menu._activeMenuItem) {
                //    this.menu._activeMenuItem.activate();
                this.appThis.contextMenu.close();
                this.appThis.clearEnteredActors();
                this.handleEnter();
            } else {
                this.activate();
            }
            return Clutter.EVENT_STOP;
        } else if (button === 3) {//right click
            if (this.appThis.contextMenu.isOpen) {
                this.appThis.contextMenu.close();
                this.appThis.clearEnteredActors();
                this.handleEnter();
            } else {
                if (this.app != null) {
                    this.openContextMenu(e);
                }
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    activate() {
        if (this.callback) {
            this.callback();
        } else if (this.app.type === APPTYPE.application) {
            this.app.newAppShouldHighlight = false;
            this.app.open_new_window(-1);
            this.appThis.closeMenu();
        }
    }

    openContextMenu(e) {
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
        this.appThis.contextMenu.open(this.app, e, this);
    }

    handleEnter(actor, event) {
        if (this.appThis.contextMenu.isOpen) {
            return true;
        }

        if (event) {
            this.appThis.clearEnteredActors();
        } else {
            this.appThis.scrollToButton(this);
        }

        this.entered = true;
        if (!this.actor) return;
        this.actor.add_style_pseudo_class('hover');

        //show tooltip
        let [x, y] = this.actor.get_transformed_position();
        x += this.actor.width + 2 * global.ui_scale;
        y += this.actor.height + 6 * global.ui_scale;
        let text = `<span>${this.name}</span>`;
        if (this.description) {
            text += '\n<span size="small">' + this.description + '</span>';
        }
        showTooltip(this.actor, x, y, false /*don't center x*/, text);
        this.tooltip = true;
        return true;
    }

    handleLeave() {
        if (this.appThis.contextMenu.isOpen) {
            return true;
        }
        this.entered = null;
        this.actor.remove_style_pseudo_class('hover');
        if (this.tooltip) {
            hideTooltip();
            this.tooltip = false;
        }
        return true;
    }

    /*setIcon(iconName) {
        this.removeActor(this.icon);
        this.icon.destroy();
        this.icon = this.icon = new St.Icon({
            icon_name: iconName,
            icon_size: this.iconSize,
            icon_type: St.IconType.FULLCOLOR
        });
        this.addActor(this.icon);
        this.icon.realize();
    }*/

    destroy() {
        this.signals.disconnectAllSignals();

        if (this.icon) {
            this.icon.destroy();
        }

        super.destroy();
        unref(this);
    }
}

module.exports = {CategoryListButton, AppListGridButton, ContextMenu, GroupButton};
