 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SimpleDAO
 * @notice DAO с голосованием и передачей голосов
 */
contract SimpleDAO {
    // STATE 
    mapping(address => uint256) public votes;
    uint256 public totalVotes;
    address[] public founders;
    uint256 public proposalCount;
    uint256 public transferCount;

    struct Proposal {
        string description;
        string[] options;
        uint256[] voteCounts;
        uint256 deadline;
        uint256 totalVotersAtStart;
        uint256 votedCount;
        bool executed;
    }

    struct TransferProposal {
        address from;
        address to;
        uint256 amount;
        uint256 yesVotes;
        uint256 totalVotesAtStart;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => TransferProposal) public transferProposals;

    // hasVoted хранится отдельно (mapping внутри struct нельзя возвращать)
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public hasVotedTransfer;

    // EVENTS 
    event ProposalCreated(uint256 indexed id, address creator, string description);
    event Voted(uint256 indexed proposalId, address voter, uint256 optionIndex, uint256 weight);
    event ProposalFinished(uint256 indexed id, uint256 winningOption);
    event TransferProposed(uint256 indexed id, address from, address to, uint256 amount);
    event TransferExecuted(uint256 indexed id, address from, address to, uint256 amount);

    // CONSTRUCTOR 
    constructor(address[] memory _founders, uint256[] memory _votes) {
        require(_founders.length == _votes.length, "Length mismatch");
        require(_founders.length > 0, "Empty founders");

        for (uint256 i = 0; i < _founders.length; i++) {
            require(_founders[i] != address(0), "Zero address");
            votes[_founders[i]] = _votes[i];
            totalVotes += _votes[i];
            founders.push(_founders[i]);
        }
    }

    // PROPOSALS 
    function createProposal(
        string memory description,
        string[] memory options,
        uint256 durationInSeconds
    ) external returns (uint256 proposalId) {
        require(votes[msg.sender] > 0, "No voting power");
        require(options.length >= 2, "Need at least 2 options");
        require(durationInSeconds > 0, "Duration must be > 0");

        uint256 totalVotersAtStart = 0;
        for (uint256 i = 0; i < founders.length; i++) {
            if (votes[founders[i]] > 0) {
                totalVotersAtStart++;
            }
        }

        proposalId = proposalCount;
        Proposal storage p = proposals[proposalId];
        p.description = description;
        p.options = options;
        p.voteCounts = new uint256[](options.length);
        p.deadline = block.timestamp + durationInSeconds;
        p.totalVotersAtStart = totalVotersAtStart;
        p.votedCount = 0;
        p.executed = false;

        proposalCount++;

        emit ProposalCreated(proposalId, msg.sender, description);
    }

    function vote(uint256 proposalId, uint256 optionIndex) external {
        require(proposalId < proposalCount, "Invalid proposal");
        Proposal storage p = proposals[proposalId];

        require(!p.executed, "Already executed");
        require(block.timestamp <= p.deadline, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(optionIndex < p.options.length, "Invalid option");
        require(votes[msg.sender] > 0, "No voting power");

        uint256 weight = votes[msg.sender];
        p.voteCounts[optionIndex] += weight;
        p.votedCount += 1;
        hasVoted[proposalId][msg.sender] = true;

        emit Voted(proposalId, msg.sender, optionIndex, weight);
    }

    // VIEW FUNCTIONS
    function getProposal(uint256 id)
        external
        view
        returns (
            string memory description,
            string[] memory options,
            uint256[] memory voteCounts,
            uint256 deadline,
            uint256 totalVotersAtStart,
            uint256 votedCount,
            bool executed
        )
    {
        require(id < proposalCount, "Invalid proposal");
        Proposal storage p = proposals[id];
        return (
            p.description,
            p.options,
            p.voteCounts,
            p.deadline,
            p.totalVotersAtStart,
            p.votedCount,
            p.executed
        );
    }

    function isProposalFinished(uint256 id) public view returns (bool) {
        require(id < proposalCount, "Invalid proposal");
        Proposal storage p = proposals[id];
        return (block.timestamp > p.deadline) || (p.votedCount == p.totalVotersAtStart);
    }

    function getWinningOption(uint256 id) external view returns (uint256) {
        require(isProposalFinished(id), "Voting not finished");
        Proposal storage p = proposals[id];

        uint256 maxVotes = 0;
        uint256 winner = 0;
        for (uint256 i = 0; i < p.voteCounts.length; i++) {
            if (p.voteCounts[i] > maxVotes) {
                maxVotes = p.voteCounts[i];
                winner = i;
            }
        }
        return winner;
    }

    function getVotes(address account) external view returns (uint256) {
        return votes[account];
    }

    // TRANSFER VOTES
    function proposeTransferVotes(
        address from,
        address to,
        uint256 amount
    ) external returns (uint256) {
        require(votes[msg.sender] > 0, "No voting power");
        require(from != address(0) && to != address(0), "Zero address");
        require(amount > 0, "Amount must be > 0");
        require(votes[from] >= amount, "Insufficient votes");

        uint256 transferId = transferCount;
        TransferProposal storage tp = transferProposals[transferId];
        tp.from = from;
        tp.to = to;
        tp.amount = amount;
        tp.yesVotes = 0;
        tp.totalVotesAtStart = totalVotes;
        tp.executed = false;

        transferCount++;

        emit TransferProposed(transferId, from, to, amount);
        return transferId;
    }

    function voteForTransfer(uint256 transferId, bool support) external {
        require(transferId < transferCount, "Invalid transfer");
        TransferProposal storage tp = transferProposals[transferId];

        require(!tp.executed, "Already executed");
        require(!hasVotedTransfer[transferId][msg.sender], "Already voted");
        require(votes[msg.sender] > 0, "No voting power");

        hasVotedTransfer[transferId][msg.sender] = true;

        if (support) {
            tp.yesVotes += votes[msg.sender];
        }
    }

    function executeTransfer(uint256 transferId) external {
        require(transferId < transferCount, "Invalid transfer");
        TransferProposal storage tp = transferProposals[transferId];

        require(!tp.executed, "Already executed");
        // строго > 50%
        require(tp.yesVotes * 2 > tp.totalVotesAtStart, "Not enough yes votes");

        require(votes[tp.from] >= tp.amount, "Insufficient balance");

        votes[tp.from] -= tp.amount;
        votes[tp.to] += tp.amount;
        tp.executed = true;

        emit TransferExecuted(transferId, tp.from, tp.to, tp.amount);
    }
}
