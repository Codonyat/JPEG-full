//SPDX-License-Identifier: MIT

/// @title JPEG Mining Proof of Concept
/// @author Xatarrer
/// @notice Unaudited
pragma solidity ^0.8.4;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@rari-capital/solmate/src/utils/SSTORE2.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/** 
    @dev Total gas (mint fee + dev fee) is monotonically increassing according to gas = 177551*tokenId+2422449
    @dev At 100 gwei this reprents an initial mining price of 0.24 ETH and a final price of 2 ETH.

    @dev Return data URL:
    https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
    https://en.wikipedia.org/wiki/Data_URI_scheme

    @dev Base64 encoding/decoding available at https://github.com/Brechtpd/base64/blob/main/base64.sol
    
    @dev Large efficient immutable storage: https://github.com/0xsequence/sstore2/blob/master/contracts/SSTORE2.sol
*/

contract JPEGminer is ERC721Enumerable, Ownable {
    using SafeMath for uint256;

    event Mined(
        // Also include the phase it was mined on
        address minerAddress,
        uint256 indexed gasSpent,
        string indexed phase
    );

    uint256 public constant NSCANS = 100;

    string private constant _NAME = "JPEG Mining";
    string private constant _DESCRIPTION =
        "JPEG Mining is a collaborative effort to store a 1.45MB on-chain image in Base64 format (1.09MB in binary). "
        "The image is split into 100 pieces which are stored on-chain by every wallet that calls the function mine(). "
        "Thanks to the progressive JPEG technology the image is viewable since its first piece is mined, "
        "and its quality gradually improves until the final image when the last piece is mined. "
        "As the image's quality improves over each successive mining, it goes through 3 different clear phases:  \r"
        "1) image is black & white only,  \r2) color is added, and  \r3) resolution improves until the final version. \r"
        "The B&W phase is the shortest and only lasts 11 uploads, "
        "the color phase last 22 uploads, and the resolution phase is the longest with 67 uploads. "
        "Every miner gets an NFT of the image but with the quality at the time of mining; "
        "or in other words, each NFT represents a step of the progressive JPEG.  \r"
        "Art by Logan Turner. Idea and code by Xatarrer.";

    // Replace the hashes before deployment
    address private immutable _imageHashesPointer;
    address private immutable _imageHeaderPointer;
    address[] private _imageScansPointers;
    string private constant _imageFooterB64 = "/9k=";

    constructor(string memory imageHeaderB64, bytes32[] memory imageHashes) ERC721("JPEG Miner", "JM") {
        require(imageHashes.length == NSCANS);

        // Store header
        _imageHeaderPointer = SSTORE2.write(bytes(imageHeaderB64));

        // Store hashes
        _imageHashesPointer = SSTORE2.write(abi.encodePacked(imageHashes));

        // Initialize array of pointers to scans
        _imageScansPointers = new address[](NSCANS);
    }

    /// @return JSON with properties
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");

        return
            mergeScans(
                tokenId,
                string(
                    abi.encodePacked(
                        '{"name": "',
                        _NAME,
                        ": ",
                        Strings.toString(tokenId + 1),
                        " of ",
                        Strings.toString(NSCANS),
                        ' copies", "description": "',
                        _DESCRIPTION,
                        '", "image": "data:image/jpeg;base64,',
                        string(SSTORE2.read(_imageHeaderPointer))
                    )
                ),
                string(abi.encodePacked(_imageFooterB64, '","attributes": [{"trait_type": "kilobytes", "value": ')),
                string(abi.encodePacked('}, {"trait_type": "phase", "value": "', getPhase(tokenId), '"}]}'))
            );
    }

    function mergeScans(
        uint256 tokenId,
        string memory preImage,
        string memory posImage,
        string memory lastText
    ) private view returns (string memory) {
        // Get scans
        uint256 KB = 0;
        string[] memory data = new string[](9);

        for (uint256 i = 0; i < 9; i++) {
            if (tokenId < 12 * i) break;

            string[] memory scans = new string[](12);

            for (uint256 j = 0; j < 12; j++) {
                if (tokenId < 12 * i + j) break;

                bytes memory scan = SSTORE2.read(_imageScansPointers[12 * i + j]);
                scans[j] = string(scan);
                KB += scan.length;
            }

            data[i] = string(
                abi.encodePacked(
                    scans[0],
                    scans[1],
                    scans[2],
                    scans[3],
                    scans[4],
                    scans[5],
                    scans[6],
                    scans[7],
                    scans[8],
                    scans[9],
                    scans[10],
                    scans[11]
                )
            );
        }

        return (
            string(
                abi.encodePacked(
                    preImage,
                    data[0],
                    data[1],
                    data[2],
                    data[3],
                    data[4],
                    data[5],
                    data[6],
                    data[7],
                    data[8],
                    posImage,
                    string(abi.encodePacked(Strings.toString(KB / 1024), lastText))
                )
            )
        );
    }

    function getPhase(uint256 tokenId) public pure returns (string memory) {
        require(tokenId < NSCANS);

        if (tokenId <= 10) return "Black & White";
        else if (tokenId <= 32) return "Color";
        else return "Resolution";
    }

    function getHash(uint256 tokenId) public view returns (bytes32) {
        require(tokenId < NSCANS);

        bytes memory hashBytes = SSTORE2.read(_imageHashesPointer, tokenId * 32, (tokenId + 1) * 32);

        bytes32 out;
        for (uint256 i = 0; i < 32; i++) {
            out |= bytes32(hashBytes[i] & 0xFF) >> (i * 8);
        }
        return out;
    }

    /// @param imageScanB64 Piece of image data in base64
    function mine(string calldata imageScanB64) external payable {
        uint256 startGas = gasleft();

        // Checks
        require(msg.sender == tx.origin, "Only EA's can mine");
        require(balanceOf(msg.sender) == 0, "Cannot mine more than once");
        require(totalSupply() < NSCANS, "Mining is over");

        // Check hash matches
        require(keccak256(bytes(imageScanB64)) == getHash(totalSupply()), "Wrong data");

        // SSTORE2 scan
        _imageScansPointers[totalSupply()] = SSTORE2.write(bytes(imageScanB64));

        // Mint scan
        uint256 tokenId = totalSupply();
        _mint(msg.sender, tokenId);

        // Charge gas fee
        uint256 gasSpent = startGas - gasleft();
        uint256 totalGasToPay = 70707 * tokenId + 3000000;
        uint256 gasToPay = totalGasToPay.sub(gasSpent + 260000); // estimated bias of the gas estimator

        console.log(gasToPay);
        uint256 fee = tx.gasprice * gasToPay;

        require(msg.value >= fee, "ETH fee insufficient"); // DO IT BEFORE MINING OR SOME PEOPLE MAY WASTE A LOT OF GAS!!

        // Return change
        payable(msg.sender).transfer(msg.value - fee);

        emit Mined(msg.sender, totalGasToPay, getPhase(tokenId));
    }

    function withdrawEth() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function withdrawToken(address addrERC20) external onlyOwner {
        uint256 balance = IERC20(addrERC20).balanceOf(address(this));
        IERC20(addrERC20).transfer(owner(), balance);
    }
}

// LINEAR GAS INCREASE (MINING+FEE)
// PRICE NFT IN GAS
