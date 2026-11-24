 const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SimpleDAO", function () {
  let dao;
  let owner, alice, bob, charlie, dave;
  const votesAlice = 100;
  const votesBob = 50;
  const votesCharlie = 30;

  async function deployFixture() {
    [owner, alice, bob, charlie, dave] = await ethers.getSigners();

    const SimpleDAO = await ethers.getContractFactory("SimpleDAO");
    dao = await SimpleDAO.deploy(
      [alice.address, bob.address, charlie.address],
      [votesAlice, votesBob, votesCharlie]
    );
    await dao.waitForDeployment();
    return { dao, alice, bob, charlie, dave };
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // Тест 1
  it("Корректно раздаёт голоса при деплое", async function () {
    expect(await dao.votes(alice.address)).to.equal(votesAlice);
    expect(await dao.votes(bob.address)).to.equal(votesBob);
    expect(await dao.votes(charlie.address)).to.equal(votesCharlie);
    expect(await dao.totalVotes()).to.equal(votesAlice + votesBob + votesCharlie);
  });

  // Тест 2
  it("Откат деплоя при разной длине массивов founders и votes", async function () {
    const SimpleDAO = await ethers.getContractFactory("SimpleDAO");
    await expect(
      SimpleDAO.deploy([alice.address, bob.address], [100])
    ).to.be.revertedWith("Length mismatch");
  });

  // Тест 3
  it("Откат деплоя при пустых массивах", async function () {
    const SimpleDAO = await ethers.getContractFactory("SimpleDAO");
    await expect(SimpleDAO.deploy([], [])).to.be.revertedWith("Empty founders");
  });

  // Тест 4
  it("Только учредитель с голосами > 0 может создать proposal", async function () {
    await expect(
      dao.connect(dave).createProposal("Test", ["Yes", "No"], 3600)
    ).to.be.revertedWith("No voting power");
  });

  // Тест 5
  it("Нельзя создать proposal с менее чем 2 вариантами", async function () {
    await expect(
      dao.connect(alice).createProposal("Test", ["OnlyOne"], 3600)
    ).to.be.revertedWith("Need at least 2 options");
  });

  // Тест 6
  it("Успешное создание proposal возвращает корректный id", async function () {
    const tx = await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    const receipt = await tx.wait();
    expect(await dao.proposalCount()).to.equal(1);
  });

  // Тест 7
  it("Успешное голосование увеличивает voteCounts и votedCount", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    await dao.connect(alice).vote(0, 0);

    const p = await dao.getProposal(0);
    expect(p.voteCounts[0]).to.equal(votesAlice);
    expect(p.votedCount).to.equal(1);
  });

  // Тест 8
  it("Нельзя проголосовать дважды", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    await dao.connect(alice).vote(0, 0);
    await expect(dao.connect(alice).vote(0, 1)).to.be.revertedWith("Already voted");
  });

  // Тест 9
  it("Нельзя проголосовать после дедлайна", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 100);
    await time.increase(101);
    await expect(dao.connect(alice).vote(0, 0)).to.be.revertedWith("Voting ended");
  });

  // Тест 10
  it("Нельзя проголосовать за несуществующий optionIndex", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    await expect(dao.connect(alice).vote(0, 5)).to.be.revertedWith("Invalid option");
  });

  // Тест 11
  it("Proposal завершается по истечении времени", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 100);
    expect(await dao.isProposalFinished(0)).to.be.false;
    await time.increase(101);
    expect(await dao.isProposalFinished(0)).to.be.true;
  });

  // Тест 12
  it("Proposal завершается когда проголосовали все учредители", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    await dao.connect(alice).vote(0, 0);
    await dao.connect(bob).vote(0, 0);
    await dao.connect(charlie).vote(0, 1);
    expect(await dao.isProposalFinished(0)).to.be.true;
  });

  // Тест 13
  it("getWinningOption возвращает правильный индекс", async function () {
    await dao.connect(alice).createProposal("Test", ["Yes", "No"], 3600);
    await dao.connect(alice).vote(0, 0); // 100
    await dao.connect(bob).vote(0, 1);   // 50
    await dao.connect(charlie).vote(0, 0); // 30 → Yes = 130
    expect(await dao.getWinningOption(0)).to.equal(0);
  });

  // Тест 14
  it("Можно создать предложение на передачу голосов", async function () {
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    expect(await dao.transferCount()).to.equal(1);
  });

  // Тест 15
  it("Голосование за передачу учитывает вес голосов", async function () {
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    await dao.connect(alice).voteForTransfer(0, true);
    const tp = await dao.transferProposals(0);
    expect(tp.yesVotes).to.equal(votesAlice);
  });

  // Тест 16
  it("Передача выполняется при более 50% голосов", async function () {
    // total = 180, нужно > 90
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    await dao.connect(alice).voteForTransfer(0, true); // 100
    await dao.connect(bob).voteForTransfer(0, true);   // +50 = 150 > 90

    await dao.executeTransfer(0);
    expect(await dao.votes(alice.address)).to.equal(60);
    expect(await dao.votes(dave.address)).to.equal(40);
  });

  // Тест 17
  it("Передача НЕ выполняется при <= 50% голосов", async function () {
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    await dao.connect(bob).voteForTransfer(0, true); // только 50

    await expect(dao.executeTransfer(0)).to.be.revertedWith("Not enough yes votes");
  });

  // Тест 18
  it("После передачи балансы from и to обновляются корректно", async function () {
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    await dao.connect(alice).voteForTransfer(0, true);
    await dao.connect(bob).voteForTransfer(0, true);
    await dao.executeTransfer(0);

    expect(await dao.votes(alice.address)).to.equal(60);
    expect(await dao.votes(dave.address)).to.equal(40);
    expect(await dao.totalVotes()).to.equal(180); // total не меняется
  });

  // Тест 19
  it("Получатель голосов может участвовать в новых голосованиях", async function () {
    await dao.connect(alice).proposeTransferVotes(alice.address, dave.address, 40);
    await dao.connect(alice).voteForTransfer(0, true);
    await dao.connect(bob).voteForTransfer(0, true);
    await dao.executeTransfer(0);

    // dave теперь имеет голоса и может создавать proposal
    await dao.connect(dave).createProposal("New", ["A", "B"], 3600);
    expect(await dao.proposalCount()).to.equal(1);
  });
});
