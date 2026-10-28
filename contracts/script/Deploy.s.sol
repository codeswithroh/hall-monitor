// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HallMonitor} from "../src/HallMonitor.sol";

/// forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        // CRE simulation writes through the MockKeystoneForwarder; set CRE_FORWARDER to the address
        // listed for your chain in the CRE docs (Supported Networks → forwarder addresses).
        address forwarder = vm.envAddress("CRE_FORWARDER");
        vm.startBroadcast();
        HallMonitor hm = new HallMonitor(forwarder);
        vm.stopBroadcast();
        console.log("HallMonitor:", address(hm));
    }
}
