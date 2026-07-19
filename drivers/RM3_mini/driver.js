/**
 * Driver for Broadlink devices
 *
 * Copyright 2018-2019, R Wensveen
 *
 * This file is part of com.broadlink
 * com.broadlink is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * com.broadlink is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with com.broadlink.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

const BroadlinkDriver = require("./../../lib/BroadlinkDriver");

const DeviceInfo = require("./../../lib/DeviceInfo.js");
const BroadlinkType = DeviceInfo.BroadlinkType;

// Module-level flag: shared across all instances and subclasses (RM_plus, RM_pro).
// Flow cards are global singletons — registering listeners more than once causes warnings.
let _rm3miniFlowCardsRegistered = false;

class BroadlinkRM3miniDriver extends BroadlinkDriver {
  async onInit(options = {}) {
    if (!options.CompatibilityID) {
      //CompatibilityID: 0x2737 // RM3 Mini
      options.CompatibilityID = BroadlinkType.RM; // Set default CompatibilityID
    }
    super.onInit(options);

    // this._utils.debugLog(this, "BroadlinkRM3miniDriver initialized with options:", options);

    if (_rm3miniFlowCardsRegistered) return;
    _rm3miniFlowCardsRegistered = true;

    this.rm3mini_action_send_cmd = this.homey.flow.getActionCard("send_command_rm3mini");
    this.rm3mini_action_send_cmd
      .registerRunListener(this.do_exec_cmd.bind(this))
      .getArgument("variable")
      .registerAutocompleteListener((query, args) => {
        return args.device.onAutoComplete();
      });

    // Register a function to fill the trigger-flowcard 'RC_specific_sent' (see app.json)
    this.rm3mini_specific_cmd_trigger = this.homey.flow.getDeviceTriggerCard("RC_specific_sent_rm3mini");
    this.rm3mini_specific_cmd_trigger
      .registerRunListener(this.check_condition_specific_cmd.bind(this))
      .getArgument("variable")
      .registerAutocompleteListener((query, args) => {
        return args.device.onAutoComplete();
      });

    this.rm3mini_any_cmd_trigger = this.homey.flow.getDeviceTriggerCard("RC_sent_any_rm3mini");
  }

  check_condition_specific_cmd(args, state) {
    return args.device.check_condition_specific_cmd_sent(args, state);
  }

  do_exec_cmd(args, state) {
    return args.device.executeCommand(args);
  }
}

module.exports = BroadlinkRM3miniDriver;
