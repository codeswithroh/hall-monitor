// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title Hall Monitor: on-chain record of children's-privacy audits
/// @notice Receives DON-signed audit reports from the Hall Monitor CRE workflow. Each report says which
/// third-party trackers a quorum of independent nodes observed on a child-directed page. The contract
/// keeps first-seen / last-seen per (page, tracker), so the duration of a violation and whether it was
/// remediated come from the chain, not from anyone's testimony.
contract HallMonitor is IReceiver, Ownable {
    enum Category {
        Unknown,
        Advertising,
        Analytics,
        Social,
        SessionReplay,
        Fingerprinting,
        TagManager
    }

    enum Severity {
        None,
        Review,
        Medium,
        High
    }

    struct Audit {
        bytes32 pageId;
        uint64 observedAt;
        bytes32 evidenceHash; // keccak256 of the canonical evidence pack (see tools/verify.ts)
        uint16 trackerCount;
        uint16 highCount;
    }

    struct Tracker {
        uint64 firstSeen;
        uint64 lastSeen;
        uint32 observations;
        Category category;
        Severity severity;
    }

    struct Page {
        string url;
        uint64 firstAuditAt;
        uint64 lastAuditAt;
        uint32 auditCount;
        string[] hosts; // every host ever observed on this page
    }

    mapping(address => bool) public isForwarder;
    address public expectedWorkflowOwner;

    Audit[] public audits;
    mapping(bytes32 => Page) internal _pages;
    mapping(bytes32 => mapping(bytes32 => Tracker)) internal _trackers; // pageId => hostId => tracker
    mapping(bytes32 => uint256[]) internal _pageAudits;

    event AuditRecorded(
        uint256 indexed auditId,
        bytes32 indexed pageId,
        string url,
        uint64 observedAt,
        bytes32 evidenceHash,
        uint16 trackerCount,
        uint16 highCount
    );
    event TrackerObserved(
        bytes32 indexed pageId, string host, Category category, Severity severity, uint64 firstSeen, uint64 lastSeen
    );
    event ForwarderUpdated(address indexed forwarder, bool allowed);
    event ExpectedWorkflowOwnerUpdated(address owner);

    error InvalidSender(address sender);
    error InvalidWorkflowOwner(address owner);
    error LengthMismatch();
    error StaleAudit(uint64 observedAt, uint64 lastAuditAt);

    constructor(address forwarder_) Ownable(msg.sender) {
        isForwarder[forwarder_] = true;
        emit ForwarderUpdated(forwarder_, true);
    }

    // ================================================================== CRE receiver

    /// @dev report = abi.encode(string url, uint64 observedAt, bytes32 evidenceHash,
    ///                          string[] hosts, uint8[] categories, uint8[] severities)
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (!isForwarder[msg.sender]) revert InvalidSender(msg.sender);
        if (expectedWorkflowOwner != address(0)) {
            // metadata = workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2)
            address wfOwner = address(bytes20(metadata[42:62]));
            if (wfOwner != expectedWorkflowOwner) revert InvalidWorkflowOwner(wfOwner);
        }
        (
            string memory url,
            uint64 observedAt,
            bytes32 evidenceHash,
            string[] memory hosts,
            uint8[] memory categories,
            uint8[] memory severities
        ) = abi.decode(report, (string, uint64, bytes32, string[], uint8[], uint8[]));
        _record(url, observedAt, evidenceHash, hosts, categories, severities);
    }

    function _record(
        string memory url,
        uint64 observedAt,
        bytes32 evidenceHash,
        string[] memory hosts,
        uint8[] memory categories,
        uint8[] memory severities
    ) internal {
        if (hosts.length != categories.length || hosts.length != severities.length) revert LengthMismatch();
        bytes32 pageId = keccak256(bytes(url));
        Page storage page = _pages[pageId];
        if (page.auditCount == 0) {
            page.url = url;
            page.firstAuditAt = observedAt;
        } else if (observedAt <= page.lastAuditAt) {
            revert StaleAudit(observedAt, page.lastAuditAt);
        }
        page.lastAuditAt = observedAt;
        page.auditCount += 1;

        uint16 highCount;
        for (uint256 i = 0; i < hosts.length; i++) {
            bytes32 hostId = keccak256(bytes(hosts[i]));
            Tracker storage t = _trackers[pageId][hostId];
            if (t.observations == 0) {
                t.firstSeen = observedAt;
                page.hosts.push(hosts[i]);
            }
            t.lastSeen = observedAt;
            t.observations += 1;
            t.category = Category(categories[i]);
            t.severity = Severity(severities[i]);
            if (t.severity == Severity.High) highCount++;
            emit TrackerObserved(pageId, hosts[i], t.category, t.severity, t.firstSeen, t.lastSeen);
        }

        uint256 auditId = audits.length;
        audits.push(Audit(pageId, observedAt, evidenceHash, uint16(hosts.length), highCount));
        _pageAudits[pageId].push(auditId);
        emit AuditRecorded(auditId, pageId, url, observedAt, evidenceHash, uint16(hosts.length), highCount);
    }

    // ================================================================== views

    function pageIdOf(string calldata url) external pure returns (bytes32) {
        return keccak256(bytes(url));
    }

    function getPage(bytes32 id)
        external
        view
        returns (string memory url, uint64 firstAuditAt, uint64 lastAuditAt, uint32 audited, string[] memory hosts)
    {
        Page storage p = _pages[id];
        return (p.url, p.firstAuditAt, p.lastAuditAt, p.auditCount, p.hosts);
    }

    /// @notice A tracker is "active" if it was present in the page's latest audit, "remediated" otherwise.
    /// persistedSeconds is first-seen to last-seen: the span over which the DON kept observing it.
    function getTracker(bytes32 id, string calldata host)
        external
        view
        returns (Tracker memory t, bool active, uint64 persistedSeconds)
    {
        t = _trackers[id][keccak256(bytes(host))];
        active = t.observations > 0 && t.lastSeen == _pages[id].lastAuditAt;
        persistedSeconds = t.lastSeen - t.firstSeen;
    }

    function auditsFor(bytes32 id) external view returns (uint256[] memory) {
        return _pageAudits[id];
    }

    function auditCount() external view returns (uint256) {
        return audits.length;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ================================================================== admin

    function setForwarder(address forwarder_, bool allowed) external onlyOwner {
        isForwarder[forwarder_] = allowed;
        emit ForwarderUpdated(forwarder_, allowed);
    }

    function setExpectedWorkflowOwner(address owner_) external onlyOwner {
        expectedWorkflowOwner = owner_;
        emit ExpectedWorkflowOwnerUpdated(owner_);
    }
}
