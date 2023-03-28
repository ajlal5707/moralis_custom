const { BigNumber } = require("bignumber.js");
BigNumber.config({
  EXPONENTIAL_AT: 40,
});

function convertPriceIntoWei(price, unit = 6) {
  return new BigNumber(new BigNumber(price).toNumber())
    .multipliedBy(Math.pow(10, unit))
    .toString();
}

function convertWeiIntoPrice(wei, unit = 6) {
  return new BigNumber(
    new BigNumber(wei).dividedBy(Math.pow(10, unit))
  ).toNumber();
}

function convertOriginalPriceToTotalPrice(
  originalPrice,
  royalty = 0,
  platformCommission = 0
) {
  return (
    Number(originalPrice) *
    (1 + Number(platformCommission) / 100 + Number(royalty) / 100)
  );
}

function convertTotalPriceToOriginalPrice(
  price,
  royalty = 0,
  platformCommission = 0
) {
  return (
    Number(price) /
    (1 + Number(platformCommission) / 100 + Number(royalty) / 100)
  );
}

module.exports = {
  convertPriceIntoWei,
  convertWeiIntoPrice,
  convertOriginalPriceToTotalPrice,
  convertTotalPriceToOriginalPrice,
};
