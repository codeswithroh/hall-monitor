// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HallMonitor} from "../src/HallMonitor.sol";

contract HallMonitorTest is Test {
    HallMonitor hm;
    address forwarder = address(0xF0);
    string constant URL = "http://localhost:8787/";

    function setUp() public {
        hm = new HallMonitor(forwarder);
    }

    function _report(uint64 at, string[] memory hosts, uint8[] memory cats, uint8[] memory sevs)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(URL, at, keccak256(abi.encode(at)), hosts, cats, sevs);
    }

    function _one(string memory h, uint8 c, uint8 s)
        internal
        pure
        returns (string[] memory hosts, uint8[] memory cats, uint8[] memory sevs)
    {
        hosts = new string[](1);
        cats = new uint8[](1);
        sevs = new uint8[](1);
        hosts[0] = h;
        cats[0] = c;
        sevs[0] = s;
    }

    function test_rejectsNonForwarder() public {
        (string[] memory h, uint8[] memory c, uint8[] memory s) = _one("doubleclick.net", 1, 3);
        vm.expectRevert(abi.encodeWithSelector(HallMonitor.InvalidSender.selector, address(this)));
        hm.onReport("", _report(100, h, c, s));
    }

    function test_persistenceAndRemediation() public {
        (string[] memory h, uint8[] memory c, uint8[] memory s) = _one("doubleclick.net", 1, 3);
        vm.startPrank(forwarder);
        hm.onReport("", _report(1000, h, c, s));
        hm.onReport("", _report(1000 + 14 days, h, c, s));
        bytes32 id = keccak256(bytes(URL));
        (HallMonitor.Tracker memory t, bool active, uint64 persisted) = hm.getTracker(id, "doubleclick.net");
        assertEq(t.observations, 2);
        assertTrue(active);
        assertEq(persisted, 14 days);
        assertEq(uint8(t.severity), 3);

        // Site removes the tracker: a clean audit leaves it inactive but keeps the history.
        hm.onReport("", _report(1000 + 15 days, new string[](0), new uint8[](0), new uint8[](0)));
        (t, active, persisted) = hm.getTracker(id, "doubleclick.net");
        assertFalse(active);
        assertEq(persisted, 14 days);
        assertEq(hm.auditCount(), 3);
        vm.stopPrank();
    }

    function test_rejectsStaleAudit() public {
        (string[] memory h, uint8[] memory c, uint8[] memory s) = _one("hotjar.com", 4, 3);
        vm.startPrank(forwarder);
        hm.onReport("", _report(2000, h, c, s));
        vm.expectRevert(abi.encodeWithSelector(HallMonitor.StaleAudit.selector, uint64(2000), uint64(2000)));
        hm.onReport("", _report(2000, h, c, s));
        vm.stopPrank();
    }
}
